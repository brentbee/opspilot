import type postgres from "postgres";
import { CUSTOMERS, NEW_ITEMS } from "./seed-data";
import HISTORY_JSON from "./seed-history.json";
import type { Category, Extracted, Priority, StepKind } from "./types";

const DAY = 86_400_000;
const MINUTE = 60_000;

/** A real agent run captured by scripts/capture-history.ts. */
interface HistoryRun {
  subject: string;
  body: string;
  from_name: string | null;
  from_email: string | null;
  category: Category | null;
  priority: Priority | null;
  confidence: number | null;
  extracted: Extracted | null;
  customer_email: string | null;
  draft_reply: string | null;
  route_reason: string | null;
  agent_ms: number | null;
  final: "ready" | "needs_review";
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  steps: { kind: StepKind; tool: string | null; payload: Record<string, unknown> }[];
}

export const HISTORY = HISTORY_JSON as HistoryRun[];

/**
 * Wipes all data and loads the synthetic demo set in one transaction.
 * Used by `npm run db:setup` and the "Reset demo" button.
 *
 * The Done column is real history: emails the agent actually processed, with
 * their full step timeline and draft, which a member of staff then approved.
 * Dates are spread over the last two weeks so the dashboard has shape.
 */
export async function resetDemoData(sql: postgres.Sql): Promise<{ customers: number; history: number; fresh: number }> {
  await sql.begin(async (tx) => {
    await tx`truncate agent_steps, agent_runs, items, customers, settings restart identity cascade`;

    const customers = await tx<{ id: string; email: string }[]>`
      insert into customers ${tx(CUSTOMERS.map((c) => ({ ...c })))} returning id, email`;
    const byEmail = new Map(customers.map((c) => [c.email, c.id]));

    for (const [i, h] of HISTORY.entries()) {
      // Two or three items a day across the last 13 days, during business hours.
      const daysAgo = 13 - Math.floor((i * 13) / Math.max(HISTORY.length, 1));
      const created = new Date(Date.now() - daysAgo * DAY - (2 + (i % 5) * 1.5) * 3_600_000);
      // Every third item was picked up by the morning run; the rest on request a few minutes after arriving.
      const scheduled = i % 3 === 0;
      const started = new Date(created.getTime() + (scheduled ? 45 : 4) * MINUTE);
      const processed = new Date(started.getTime() + (h.agent_ms ?? 10_000));
      const approved = new Date(processed.getTime() + (20 + (i % 4) * 25) * MINUTE);

      const [item] = await tx<{ id: string }[]>`
        insert into items (subject, body, from_name, from_email, status, position, category, priority,
                           confidence, extracted, customer_id, draft_reply, route_reason, agent_ms,
                           created_at, updated_at, processed_at)
        values (${h.subject}, ${h.body}, ${h.from_name}, ${h.from_email}, 'done', ${(i + 1) * 1024},
                ${h.category}, ${h.priority}, ${h.confidence},
                ${h.extracted ? tx.json(h.extracted as never) : null},
                ${h.customer_email ? (byEmail.get(h.customer_email) ?? null) : null},
                ${h.draft_reply}, ${h.route_reason}, ${h.agent_ms}, ${created}, ${approved}, ${processed})
        returning id`;
      const [run] = await tx<{ id: string }[]>`
        insert into agent_runs (item_id, trigger, status, model, input_tokens, output_tokens, started_at, ended_at)
        values (${item.id}, ${scheduled ? "scheduled" : "manual"}, 'succeeded', ${h.model},
                ${h.input_tokens}, ${h.output_tokens}, ${started}, ${processed})
        returning id`;
      for (const [seq, s] of h.steps.entries()) {
        const at = new Date(started.getTime() + ((h.agent_ms ?? 10_000) * seq) / Math.max(h.steps.length, 1));
        await tx`
          insert into agent_steps (run_id, item_id, seq, kind, tool, payload, created_at)
          values (${run.id}, ${item.id}, ${seq}, ${s.kind}, ${s.tool}, ${tx.json(s.payload as never)}, ${at})`;
      }
      // A member of staff checked it (if needed) and sent it.
      await tx`
        insert into agent_steps (run_id, item_id, seq, kind, payload, created_at)
        values (null, ${item.id}, 0, 'human_override',
                ${tx.json({ from: h.final, to: "done", agent_routed: true })}, ${approved})`;
    }

    // Fresh items for the live demo, oldest first.
    for (const [i, it] of NEW_ITEMS.entries()) {
      const created = new Date(Date.now() - (NEW_ITEMS.length - i) * 7 * MINUTE);
      await tx`
        insert into items (subject, body, from_name, from_email, status, position, created_at, updated_at)
        values (${it.subject}, ${it.body}, ${it.from_name}, ${it.from_email}, 'new',
                ${(i + 1) * 1024}, ${created}, ${created})`;
    }
  });
  return { customers: CUSTOMERS.length, history: HISTORY.length, fresh: NEW_ITEMS.length };
}
