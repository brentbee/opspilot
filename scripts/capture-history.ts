/**
 * Captures real agent runs from a running OpsPilot instance into
 * src/lib/seed-history.json, which seeds the Done column. That way the demo's
 * history shows genuine model output (steps, drafts, routing), not mock data.
 *
 *   npx tsx scripts/capture-history.ts https://your-deployment.example
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Customer, Item, RunSummary, Step } from "../src/lib/types";
import { NEW_ITEMS } from "../src/lib/seed-data";

const base = process.argv[2];
if (!base) {
  console.error("usage: capture-history.ts <base-url>");
  process.exit(1);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(new URL(path, base));
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function main() {
  const customers = await get<Customer[]>("/api/customers");
  const emailById = new Map(customers.map((c) => [c.id, c.email]));
  // Skip the fixed demo emails that start in New, so history doesn't duplicate them.
  const fresh = new Set(NEW_ITEMS.map((i) => i.subject));
  const items = (await get<Item[]>("/api/items")).filter(
    (i) => i.processed_at && (i.status === "ready" || i.status === "needs_review") && !fresh.has(i.subject),
  );

  const out = [];
  for (const it of items) {
    const { steps, run } = await get<{ steps: Step[]; run: RunSummary | null }>(`/api/items/${it.id}`);
    if (!run || run.status !== "succeeded") continue;
    out.push({
      subject: it.subject,
      body: it.body,
      from_name: it.from_name,
      from_email: it.from_email,
      category: it.category,
      priority: it.priority,
      confidence: it.confidence,
      extracted: it.extracted,
      customer_email: it.customer_id ? (emailById.get(it.customer_id) ?? null) : null,
      draft_reply: it.draft_reply,
      route_reason: it.route_reason,
      agent_ms: it.agent_ms,
      final: it.status,
      model: run.model,
      input_tokens: run.input_tokens,
      output_tokens: run.output_tokens,
      steps: steps.filter((s) => s.run_id).map((s) => ({ kind: s.kind, tool: s.tool, payload: s.payload })),
    });
  }

  const file = join(__dirname, "..", "src", "lib", "seed-history.json");
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`captured ${out.length} runs → ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
