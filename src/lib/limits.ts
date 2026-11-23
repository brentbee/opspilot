import { sql } from "./db";

/**
 * The demo is public and runs on a personal API key, so cap agent runs per
 * hour across all visitors. Cheap and good enough for a demo; a real product
 * would rate-limit per user/tenant.
 */
export function runLimitPerHour(): number {
  const n = Number(process.env.RUN_LIMIT_PER_HOUR ?? 60);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export async function runBudgetLeft(): Promise<number> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from agent_runs where started_at > now() - interval '1 hour'`;
  return Math.max(0, runLimitPerHour() - (row?.n ?? 0));
}

export const MAX_CREATED_PER_HOUR = 100;
export const MAX_NEW_COLUMN = 60;

/** Shared cap for anything that adds items (the form and the sample generator). */
export async function creationBlocked(adding: number): Promise<string | null> {
  const [c] = await sql()<{ recent: number; waiting: number }[]>`
    select
      (select count(*)::int from items where created_at > now() - interval '1 hour') as recent,
      (select count(*)::int from items where status = 'new') as waiting`;
  if (c.waiting + adding > MAX_NEW_COLUMN) return `New already has ${c.waiting} items; process some first`;
  if (c.recent + adding > MAX_CREATED_PER_HOUR) return "Hourly demo limit reached, try again later";
  return null;
}

/** Reset is shared by every visitor: refuse while a run is in progress, and at most every 30 s. */
export async function resetBlocked(): Promise<string | null> {
  const [c] = await sql()<{ running: number; recent: boolean }[]>`
    select
      (select count(*)::int from agent_runs where status = 'running' and started_at > now() - interval '3 minutes') as running,
      coalesce((select max(created_at) > now() - interval '30 seconds' from customers), false) as recent`;
  if (c.running > 0) return "The assistant is working on an email. Try again in a moment.";
  if (c.recent) return "The demo was just reset. Try again in a few seconds.";
  return null;
}
