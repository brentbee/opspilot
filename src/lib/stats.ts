import { sql } from "./db";

export interface Stats {
  totals: {
    items: number;
    processed: number;
    auto_ready: number;
    needs_review: number;
    done: number;
    avg_agent_ms: number | null;
    human_overrides: number;
    tokens: number;
  };
  /** Share of agent-processed items the policy let through without review. */
  auto_rate: number | null;
  by_category: { category: string; count: number }[];
  per_day: { day: string; created: number; processed: number }[];
  minutes_saved: number;
  scheduled: { last_run_at: string | null; runs_7d: number; manual_runs_7d: number };
}

/** Rough handling time a person spends per item without the agent, for the "time saved" KPI. */
export const MANUAL_MINUTES_PER_ITEM = 6;

export async function getStats(): Promise<Stats> {
  const db = sql();
  const [[totals], byCategory, perDay, [routing], [scheduled]] = await Promise.all([
    db<Stats["totals"][]>`
      select
        (select count(*)::int from items) as items,
        (select count(*)::int from items where processed_at is not null) as processed,
        (select count(*)::int from items where status = 'ready') as auto_ready,
        (select count(*)::int from items where status = 'needs_review') as needs_review,
        (select count(*)::int from items where status = 'done') as done,
        (select round(avg(agent_ms))::int from items where agent_ms is not null) as avg_agent_ms,
        (select count(*)::int from agent_steps where kind = 'human_override') as human_overrides,
        (select coalesce(sum(input_tokens + output_tokens), 0)::int from agent_runs) as tokens`,
    db<Stats["by_category"]>`
      select coalesce(category, 'unprocessed') as category, count(*)::int as count
      from items group by 1 order by 2 desc`,
    db<Stats["per_day"]>`
      with days as (
        select generate_series(current_date - 13, current_date, interval '1 day')::date as day)
      select to_char(d.day, 'YYYY-MM-DD') as day,
        (select count(*)::int from items i where i.created_at::date = d.day) as created,
        (select count(*)::int from items i where i.processed_at::date = d.day) as processed
      from days d order by d.day`,
    // Latest policy decision per agent-processed item: was it auto-routed to ready?
    db<{ routed: number; auto: number }[]>`
      select count(*)::int as routed,
             count(*) filter (where payload->>'final' = 'ready')::int as auto
      from (
        select distinct on (item_id) item_id, payload from agent_steps
        where kind = 'route' order by item_id, id desc) last_route`,
    db<Stats["scheduled"][]>`
      select
        (select max(started_at) from agent_runs where trigger = 'scheduled' and model <> 'seed') as last_run_at,
        (select count(*)::int from agent_runs where trigger = 'scheduled' and model <> 'seed'
           and started_at > now() - interval '7 days') as runs_7d,
        (select count(*)::int from agent_runs where trigger = 'manual'
           and started_at > now() - interval '7 days') as manual_runs_7d`,
  ]);

  return {
    totals,
    auto_rate: routing.routed ? routing.auto / routing.routed : null,
    by_category: byCategory,
    per_day: perDay,
    minutes_saved: totals.processed * MANUAL_MINUTES_PER_ITEM,
    scheduled,
  };
}
