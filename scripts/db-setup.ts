/**
 * Creates the schema and loads synthetic seed data.
 *
 *   npm run db:setup           # create tables (idempotent), seed only if empty
 *   npm run db:setup -- --reset  # wipe all data and reseed (demo reset)
 *
 * Also runs on every Vercel deploy (`vercel-build`), so a fresh Supabase
 * project is set up automatically on the first deploy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { CUSTOMERS, HISTORY, NEW_ITEMS } from "./seed-data";
import { resolveDatabaseUrl } from "../src/lib/dburl";

const DAY = 86_400_000;

async function main() {
  const url = resolveDatabaseUrl();
  if (!url) {
    // Lets `vercel-build` run in environments without a database (e.g. CI).
    console.warn("db:setup skipped: DATABASE_URL / POSTGRES_URL is not set");
    return;
  }
  const reset = process.argv.includes("--reset");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

  try {
    await sql.unsafe(readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8"));
    console.log("schema ok");

    if (reset) {
      await sql`truncate agent_steps, agent_runs, items, customers restart identity cascade`;
      console.log("data wiped");
    }

    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from customers`;
    if (n > 0) {
      console.log(`already seeded (${n} customers); use --reset to reseed`);
      return;
    }

    await sql.begin(async (tx) => {
      const customers = await tx<{ id: string; email: string }[]>`
        insert into customers ${tx(CUSTOMERS.map((c) => ({ ...c })))} returning id, email`;
      const byEmail = new Map(customers.map((c) => [c.email, c.id]));

      // History: items an agent already handled and a human then closed.
      for (const [i, h] of HISTORY.entries()) {
        const created = new Date(Date.now() - h.daysAgo * DAY - 3 * 3_600_000);
        const processed = new Date(created.getTime() + 5 * 60_000);
        const [item] = await tx<{ id: string }[]>`
          insert into items (subject, body, from_email, status, position, category, priority,
                             confidence, customer_id, draft_reply, route_reason, agent_ms,
                             created_at, updated_at, processed_at)
          values (${h.subject}, ${"(historical seed item)"}, ${h.customerEmail}, 'done',
                  ${(i + 1) * 1024}, ${h.category}, ${h.priority}, ${h.confidence},
                  ${h.customerEmail ? (byEmail.get(h.customerEmail) ?? null) : null},
                  ${"(sent)"}, ${h.finalRoute === "ready" ? "Ready: seeded history." : "Needs review: seeded history."},
                  ${h.agentMs}, ${created}, ${processed}, ${processed})
          returning id`;
        const [run] = await tx<{ id: string }[]>`
          insert into agent_runs (item_id, trigger, status, model, input_tokens, output_tokens,
                                  started_at, ended_at)
          values (${item.id}, 'scheduled', 'succeeded', 'seed', 5200, 700, ${created}, ${processed})
          returning id`;
        await tx`
          insert into agent_steps (run_id, item_id, seq, kind, tool, payload, created_at)
          values (${run.id}, ${item.id}, 0, 'route', 'policy',
                  ${tx.json({ requested: h.finalRoute, final: h.finalRoute, overridden: false, reasons: [] })},
                  ${processed})`;
        if (h.finalRoute === "needs_review") {
          await tx`
            insert into agent_steps (run_id, item_id, seq, kind, payload, created_at)
            values (null, ${item.id}, 0, 'human_override',
                    ${tx.json({ from: "needs_review", to: "done", agent_routed: true })}, ${processed})`;
        }
      }

      // Fresh items for the live demo, oldest first.
      for (const [i, it] of NEW_ITEMS.entries()) {
        const created = new Date(Date.now() - (NEW_ITEMS.length - i) * 7 * 60_000);
        await tx`
          insert into items (subject, body, from_name, from_email, status, position, created_at, updated_at)
          values (${it.subject}, ${it.body}, ${it.from_name}, ${it.from_email}, 'new',
                  ${(i + 1) * 1024}, ${created}, ${created})`;
      }
    });

    console.log(`seeded ${CUSTOMERS.length} customers, ${HISTORY.length} history items, ${NEW_ITEMS.length} new items`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
