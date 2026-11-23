import { sql } from "./db";

/**
 * The demo is public and runs on a personal API key, so cap agent runs per
 * hour across all visitors. Cheap and good enough for a demo; a real product
 * would rate-limit per user/tenant.
 */
export function runLimitPerHour(): number {
  const n = Number(process.env.RUN_LIMIT_PER_HOUR ?? 40);
  return Number.isFinite(n) && n > 0 ? n : 40;
}

export async function runBudgetLeft(): Promise<number> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from agent_runs where started_at > now() - interval '1 hour'`;
  return Math.max(0, runLimitPerHour() - (row?.n ?? 0));
}
