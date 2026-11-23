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
import { resetDemoData } from "../src/lib/seed";
import { resolveDatabaseUrl } from "../src/lib/dburl";

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

    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from customers`;
    if (n > 0 && !reset) {
      console.log(`already seeded (${n} customers); use --reset to reseed`);
      return;
    }
    const r = await resetDemoData(sql);
    console.log(`seeded ${r.customers} customers, ${r.history} history items, ${r.fresh} new items`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
