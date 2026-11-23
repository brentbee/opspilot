/**
 * Offline eval: runs the real agent over the labelled seed items and scores
 * category and routing accuracy. Needs only ANTHROPIC_API_KEY (no database):
 * customers and items are held in memory.
 *
 *   npm run eval
 *   AGENT_MODEL=claude-haiku-5-5 npm run eval   # compare models
 */
import { anthropicLLM } from "../src/agent/llm";
import { runAgent, type AgentStore } from "../src/agent/runAgent";
import type { Customer, Item, Step } from "../src/lib/types";
import { CUSTOMERS, NEW_ITEMS } from "../src/lib/seed-data";

const customers: Customer[] = CUSTOMERS.map((c, i) => ({ ...c, id: `c${i}`, created_at: "" }));

function memoryStore(item: Item): AgentStore & { steps: Step[] } {
  const steps: Step[] = [];
  return {
    steps,
    getItem: async () => item,
    updateItem: async (_id, patch) => Object.assign(item, patch),
    moveToBottom: async (_id, status) => ((item.status = status), 0),
    startRun: async () => "eval",
    finishRun: async () => {},
    insertStep: async (s) => (steps.push(s), s),
    findCustomer: async (q) =>
      customers.find((c) => q.email && c.email === q.email.toLowerCase()) ??
      customers.find((c) =>
        [q.company, q.name].some((t) => t && t.length >= 3 && `${c.company} ${c.name}`.toLowerCase().includes(t.toLowerCase())),
      ) ??
      null,
  };
}

async function main() {
  const llm = anthropicLLM();
  console.log(`Evaluating ${llm.model} on ${NEW_ITEMS.length} labelled items\n`);
  let catOk = 0;
  let routeOk = 0;
  let unsafe = 0;
  let totalMs = 0;

  for (const [i, seed] of NEW_ITEMS.entries()) {
    const item = {
      id: `i${i}`,
      subject: seed.subject,
      body: seed.body,
      from_name: seed.from_name,
      from_email: seed.from_email,
      status: "new",
    } as Item;
    const store = memoryStore(item);
    const res = await runAgent({ itemId: item.id, llm, store, emit: () => {} });
    totalMs += res.ms;

    const cat = item.category === seed.expect.category;
    const route = res.status === seed.expect.route;
    // The costly error: something that needed a human went straight to Ready.
    const isUnsafe = seed.expect.route === "needs_review" && res.status === "ready";
    catOk += +cat;
    routeOk += +route;
    unsafe += +isUnsafe;
    console.log(
      `${cat ? "✓" : "✗"} cat ${String(item.category).padEnd(13)} ${route ? "✓" : "✗"} route ${res.status.padEnd(12)} ${(res.ms / 1000).toFixed(1).padStart(5)}s  ${seed.subject}${isUnsafe ? "  ⚠ UNSAFE" : ""}`,
    );
  }

  const n = NEW_ITEMS.length;
  console.log(`\nCategory accuracy: ${catOk}/${n} (${Math.round((catOk / n) * 100)}%)`);
  console.log(`Routing accuracy:  ${routeOk}/${n} (${Math.round((routeOk / n) * 100)}%)`);
  console.log(`Unsafe auto-routes (needed a human, went to Ready): ${unsafe}`);
  console.log(`Avg time per item: ${(totalMs / n / 1000).toFixed(1)}s`);
  process.exit(unsafe > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
