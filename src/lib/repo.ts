import { sql } from "./db";
import { positionBetween } from "./ordering";
import type { Customer, Item, RunSummary, Status, Step } from "./types";
import { DEFAULT_BUSINESS, businessSchema, type Business } from "./business";

/* ---------------------------------- items --------------------------------- */

const ITEM_COLUMNS = `
  i.id, i.subject, i.body, i.from_name, i.from_email, i.status, i.position,
  i.category, i.priority, i.confidence, i.extracted, i.customer_id,
  c.name as customer_name, i.draft_reply, i.route_reason, i.agent_ms,
  i.created_at, i.updated_at, i.processed_at,
  (select r.trigger from agent_runs r where r.item_id = i.id order by r.started_at desc limit 1) as last_trigger`;

/**
 * Recovers items left in "processing" by a run that was killed (e.g. a
 * serverless timeout), so they never get stuck. Called before reads and claims.
 */
export async function releaseStale(): Promise<void> {
  await sql()`
    update agent_runs set status = 'failed', error = coalesce(error, 'interrupted'), ended_at = now()
    where status = 'running' and started_at < now() - interval '3 minutes'`;
  await sql()`
    update items set status = 'needs_review', updated_at = now(),
      route_reason = 'Needs review: the assistant was interrupted before it finished.'
    where status = 'processing' and updated_at < now() - interval '3 minutes'`;
}

/** Atomically marks one item as processing; false if it is already processing or done. */
export async function claimItem(id: string): Promise<boolean> {
  await releaseStale();
  const rows = await sql()`
    update items set status = 'processing', updated_at = now()
    where id = ${id} and status not in ('processing', 'done')
    returning id`;
  return rows.length > 0;
}

export async function listItems(): Promise<Item[]> {
  await releaseStale();
  return sql().unsafe<Item[]>(
    `select ${ITEM_COLUMNS} from items i left join customers c on c.id = i.customer_id
     order by i.status, i.position, i.created_at`,
  );
}

export async function getItem(id: string): Promise<Item | null> {
  const rows = await sql().unsafe<Item[]>(
    `select ${ITEM_COLUMNS} from items i left join customers c on c.id = i.customer_id
     where i.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function bottomPosition(status: Status): Promise<number> {
  const [row] = await sql()<{ max: number | null }[]>`
    select max(position) as max from items where status = ${status}`;
  return positionBetween(row?.max ?? null, null);
}

export interface NewItem {
  subject: string;
  body: string;
  from_name?: string | null;
  from_email?: string | null;
}

export async function createItem(input: NewItem): Promise<Item> {
  const position = await bottomPosition("new");
  const [row] = await sql()<{ id: string }[]>`
    insert into items (subject, body, from_name, from_email, status, position)
    values (${input.subject}, ${input.body}, ${input.from_name ?? null},
            ${input.from_email ?? null}, 'new', ${position})
    returning id`;
  return (await getItem(row.id))!;
}

export type ItemPatch = Partial<
  Pick<
    Item,
    | "subject"
    | "body"
    | "from_name"
    | "from_email"
    | "status"
    | "position"
    | "category"
    | "priority"
    | "confidence"
    | "extracted"
    | "customer_id"
    | "draft_reply"
    | "route_reason"
    | "agent_ms"
    | "processed_at"
  >
>;

export async function updateItem(id: string, patch: ItemPatch): Promise<Item | null> {
  const keys = Object.keys(patch) as (keyof ItemPatch)[];
  if (keys.length > 0) {
    const values: Record<string, unknown> = { ...patch, updated_at: new Date() };
    if (patch.extracted !== undefined)
      values.extracted = patch.extracted == null ? null : sql().json(patch.extracted as never);
    await sql()`update items set ${sql()(values)} where id = ${id}`;
  }
  return getItem(id);
}

export async function deleteItem(id: string): Promise<boolean> {
  const res = await sql()`delete from items where id = ${id}`;
  return res.count > 0;
}

/** Puts an item at the bottom of a column (used by the agent's routing step). */
export async function moveToBottom(id: string, status: Status): Promise<number> {
  const position = await bottomPosition(status);
  await sql()`update items set status = ${status}, position = ${position}, updated_at = now()
              where id = ${id}`;
  return position;
}

/* -------------------------------- customers ------------------------------- */

export async function listCustomers(): Promise<(Customer & { item_count: number })[]> {
  return sql()<(Customer & { item_count: number })[]>`
    select c.*, (select count(*)::int from items i
                 where i.customer_id = c.id
                    or (i.customer_id is null and lower(i.from_email) = lower(c.email))) as item_count
    from customers c order by c.name`;
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const [row] = await sql()<Customer[]>`select * from customers where id = ${id}`;
  return row ?? null;
}

export type CustomerInput = Pick<Customer, "name" | "company" | "email" | "tier" | "notes">;

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const [row] = await sql()<Customer[]>`
    insert into customers (name, company, email, tier, notes)
    values (${input.name}, ${input.company}, ${input.email?.toLowerCase() ?? null},
            ${input.tier}, ${input.notes})
    returning *`;
  return row;
}

export async function updateCustomer(
  id: string,
  patch: Partial<CustomerInput>,
): Promise<Customer | null> {
  const values = { ...patch } as Record<string, unknown>;
  if (typeof values.email === "string") values.email = values.email.toLowerCase();
  if (Object.keys(values).length > 0)
    await sql()`update customers set ${sql()(values)} where id = ${id}`;
  return getCustomer(id);
}

export async function deleteCustomer(id: string): Promise<boolean> {
  const res = await sql()`delete from customers where id = ${id}`;
  return res.count > 0;
}

export interface CustomerQuery {
  email?: string;
  name?: string;
  company?: string;
}

/** Exact email match first, then a fuzzy name/company match. */
export async function findCustomer(q: CustomerQuery): Promise<Customer | null> {
  if (q.email) {
    const [row] = await sql()<Customer[]>`
      select * from customers where lower(email) = ${q.email.toLowerCase()} limit 1`;
    if (row) return row;
  }
  for (const term of [q.company, q.name]) {
    if (!term || term.trim().length < 3) continue;
    // Escape LIKE wildcards so a crafted name like "%%%" can't match everyone.
    const like = `%${term.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const [row] = await sql()<Customer[]>`
      select * from customers
      where lower(company) like ${like} or lower(name) like ${like}
      order by length(coalesce(company, name)) limit 1`;
    if (row) return row;
  }
  return null;
}

/* ------------------------------ runs and steps ----------------------------- */

export async function startRun(
  itemId: string,
  model: string,
  trigger: "manual" | "scheduled",
): Promise<string> {
  const [row] = await sql()<{ id: string }[]>`
    insert into agent_runs (item_id, model, trigger) values (${itemId}, ${model}, ${trigger})
    returning id`;
  return row.id;
}

export async function finishRun(
  runId: string,
  result: { status: "succeeded" | "failed"; inputTokens: number; outputTokens: number; error?: string },
): Promise<void> {
  await sql()`
    update agent_runs set status = ${result.status}, input_tokens = ${result.inputTokens},
      output_tokens = ${result.outputTokens}, error = ${result.error ?? null}, ended_at = now()
    where id = ${runId}`;
}

export async function insertStep(step: Step): Promise<Step> {
  const [row] = await sql()<Step[]>`
    insert into agent_steps (run_id, item_id, seq, kind, tool, payload)
    values (${step.run_id}, ${step.item_id}, ${step.seq}, ${step.kind}, ${step.tool},
            ${sql().json(step.payload as never)})
    returning *`;
  return row;
}


export async function latestRun(itemId: string): Promise<RunSummary | null> {
  const [row] = await sql()<RunSummary[]>`
    select trigger, status, model, input_tokens, output_tokens, started_at, ended_at
    from agent_runs where item_id = ${itemId} order by started_at desc limit 1`;
  return row ?? null;
}

/** Steps of the latest run plus any human overrides, oldest first. */
export async function listSteps(itemId: string): Promise<Step[]> {
  return sql()<Step[]>`
    select s.* from agent_steps s
    where s.item_id = ${itemId}
      and (s.run_id is null or s.run_id = (
        select id from agent_runs where item_id = ${itemId} order by started_at desc limit 1))
    order by s.id`;
}

export async function claimNewItems(limit: number): Promise<string[]> {
  await releaseStale();
  const rows = await sql()<{ id: string }[]>`
    update items set status = 'processing', updated_at = now()
    where id in (
      select id from items where status = 'new' order by position limit ${limit}
      for update skip locked)
    returning id`;
  return rows.map((r) => r.id);
}

/* -------------------------------- settings -------------------------------- */

/** The saved business profile, falling back to the default for any missing field. */
export async function getBusiness(): Promise<Business> {
  const [row] = await sql()<{ value: unknown }[]>`select value from settings where key = 'business'`;
  const parsed = businessSchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_BUSINESS, ...(parsed.success ? parsed.data : {}) };
}

export async function saveBusiness(b: Business): Promise<Business> {
  await sql()`
    insert into settings (key, value) values ('business', ${sql().json(b as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  return b;
}

/** Items from a customer: linked by the agent, or sent from their email address. */
export async function listCustomerItems(customerId: string): Promise<Item[]> {
  return sql().unsafe<Item[]>(
    `select ${ITEM_COLUMNS} from items i left join customers c on c.id = i.customer_id
     where i.customer_id = $1
        or (i.customer_id is null and lower(i.from_email) = (select lower(email) from customers where id = $1))
     order by i.created_at desc`,
    [customerId],
  );
}
