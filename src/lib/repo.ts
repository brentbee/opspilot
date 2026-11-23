import { sql } from "./db";
import { positionBetween } from "./ordering";
import type { Customer, Item, Status, Step } from "./types";

/* ---------------------------------- items --------------------------------- */

const ITEM_COLUMNS = `
  i.id, i.subject, i.body, i.from_name, i.from_email, i.status, i.position,
  i.category, i.priority, i.confidence, i.extracted, i.customer_id,
  c.name as customer_name, i.draft_reply, i.route_reason, i.agent_ms,
  i.created_at, i.updated_at, i.processed_at`;

export async function listItems(): Promise<Item[]> {
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
    select c.*, (select count(*)::int from items i where i.customer_id = c.id) as item_count
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
    const like = `%${term.trim().toLowerCase()}%`;
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
  const rows = await sql()<{ id: string }[]>`
    update items set status = 'processing', updated_at = now()
    where id in (
      select id from items where status = 'new' order by position limit ${limit}
      for update skip locked)
    returning id`;
  return rows.map((r) => r.id);
}
