import { runAgent } from "@/agent/runAgent";
import { anthropicLLM } from "@/agent/llm";
import * as repo from "./repo";
import { runBudgetLeft } from "./limits";

/**
 * Background workload: claims up to `limit` items from "New" (skip-locked, so
 * overlapping cron runs never double-process) and runs the agent on each.
 */
export async function processNewItems(limit: number, trigger: "manual" | "scheduled") {
  const budget = Math.min(limit, await runBudgetLeft());
  if (budget <= 0) return { processed: [], skipped: "hourly run limit reached" };

  const llm = anthropicLLM();
  const ids = await repo.claimNewItems(budget);
  const processed: { id: string; status: string; ms: number }[] = [];
  for (const id of ids) {
    const r = await runAgent({ itemId: id, llm, store: repo, emit: () => {}, trigger });
    processed.push({ id, status: r.status, ms: r.ms });
  }
  return { processed };
}
