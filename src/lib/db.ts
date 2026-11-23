import postgres from "postgres";
import { resolveDatabaseUrl } from "./dburl";

declare global {
  var __opspilotSql: postgres.Sql | undefined;
}

/**
 * One shared connection pool per server instance. `prepare: false` keeps it
 * compatible with Supabase's transaction pooler (port 6543), which is what a
 * serverless deploy on Vercel should use.
 */
export function sql(): postgres.Sql {
  if (!globalThis.__opspilotSql) {
    const url = resolveDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL (or POSTGRES_URL) is not set (see .env.example)");
    globalThis.__opspilotSql = postgres(url, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      transform: { undefined: null },
    });
  }
  return globalThis.__opspilotSql;
}
