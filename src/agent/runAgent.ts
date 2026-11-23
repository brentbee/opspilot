import type Anthropic from "@anthropic-ai/sdk";
import { decideRoute } from "@/lib/policy";
import type { AgentEvent, Item, Status, StepKind } from "@/lib/types";
import type * as repo from "@/lib/repo";
import type { AgentLLM } from "./llm";
import type { Business } from "@/lib/business";
import { itemPrompt, systemPrompt, writerPrompt, writerSystem } from "./prompt";
import { anthropicTools, emptyState, runTool, type RunState, type ToolDeps } from "./tools";

export const MAX_TURNS = 8;
/** Stop starting new model turns after this; the route allows 120 s in total. */
export const RUN_BUDGET_MS = 60_000;

/** The persistence the agent needs; the real implementation is lib/repo. */
export type AgentStore = Pick<
  typeof repo,
  "getItem" | "updateItem" | "moveToBottom" | "startRun" | "finishRun" | "insertStep" | "findCustomer" | "getBusiness"
>;

export interface RunOptions {
  itemId: string;
  llm: AgentLLM;
  store: AgentStore;
  emit: (e: AgentEvent) => void;
  trigger?: "manual" | "scheduled";
  now?: () => number;
}

export interface RunResult {
  status: Status;
  ms: number;
  runId: string | null;
}

/**
 * Runs the OpsPilot agent on one item. The caller must already have claimed
 * the item (status "processing") via claimItem / claimNewItems.
 *
 * It is a tool-use loop where every model
 * thought, tool call and tool result is saved as a step and streamed to the
 * UI, followed by the deterministic review policy that picks the final column.
 */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { itemId, llm, store, emit } = opts;
  const now = opts.now ?? Date.now;
  const started = now();

  const item = await store.getItem(itemId);
  if (!item) {
    emit({ type: "error", message: "Item not found" });
    return { status: "new", ms: 0, runId: null };
  }
  const subject: Item = item;

  let business: Business;
  let runId: string;
  try {
    business = await store.getBusiness();
    runId = await store.startRun(itemId, llm.model, opts.trigger ?? "manual");
  } catch (err) {
    // Nothing has run yet: put the item back so it can be retried.
    await store.updateItem(itemId, { status: "new" }).catch(() => {});
    emit({ type: "error", message: friendlyError(err) });
    return { status: "new", ms: 0, runId: null };
  }
  emit({ type: "run", runId, model: llm.model });

  let seq = 0;
  const usage = { input: 0, output: 0 };
  const step = async (kind: StepKind, tool: string | null, payload: Record<string, unknown>) => {
    const saved = await store.insertStep({ run_id: runId, item_id: itemId, seq: seq++, kind, tool, payload });
    emit({ type: "step", step: saved });
    return saved;
  };

  const state: RunState = emptyState();
  const deps: ToolDeps = {
    findCustomer: (q) => store.findCustomer(q),
    async writeDraft(args, s) {
      const { text, usage: u } = await llm.streamText(
        { system: writerSystem(business), prompt: writerPrompt(item, s, args.tone, args.key_points), maxTokens: 600 },
        (delta) => emit({ type: "token", text: delta }),
      );
      usage.input += u.input;
      usage.output += u.output;
      await step("draft", "draft_reply", { text });
      return text;
    },
  };

  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: itemPrompt(item) }];
    let lastStop: Anthropic.StopReason | null = null;
    const tools = anthropicTools();

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (now() - started > RUN_BUDGET_MS) {
        await step("error", null, { message: "This one took too long, so it was left for staff to check." });
        break;
      }
      if (turn > 0 && lastStop === "max_tokens") break;

      const res = await llm.turn({ system: systemPrompt(business), messages, tools });
      lastStop = res.stop_reason;
      usage.input += res.usage.input_tokens;
      usage.output += res.usage.output_tokens;
      messages.push({ role: "assistant", content: res.content });

      for (const block of res.content)
        if (block.type === "text" && block.text.trim()) await step("thought", null, { text: block.text.trim() });

      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || calls.length === 0) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        await step("tool_call", call.name, { input: call.input as Record<string, unknown> });
        const out = await runTool(call.name, call.input, state, deps);
        await step("tool_result", call.name, { ...out.content, ...(out.isError ? { is_error: true } : {}) });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(out.content),
          is_error: out.isError,
        });
      }
      messages.push({ role: "user", content: results });
      if (state.requested) break; // move_card is the last step; no need for another turn.
    }

    return await finalise(false);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Staff see a plain message; the technical detail is kept on the run record.
    const message = friendlyError(err);
    await step("error", null, { message });
    emit({ type: "error", message });
    return await finalise(true, detail);
  }

  async function finalise(failed: boolean, error?: string): Promise<RunResult> {
    const decision = decideRoute({
      requested: state.requested,
      confidence: state.classification?.confidence,
      category: state.classification?.category,
      customerFound: state.customer != null,
      senderMatchesCustomer:
        state.customer != null &&
        !!subject.from_email &&
        state.customer.email?.toLowerCase() === subject.from_email.trim().toLowerCase(),
      amount: state.extracted?.amount,
      hasDraft: Boolean(state.draft),
      finished: state.requested != null,
      text: `${subject.subject}\n${subject.body}`,
    });
    if (failed) decision.reasons.unshift("the assistant couldn't finish");
    const status: Status = failed ? "needs_review" : decision.status;
    const reason = decision.reasons.length
      ? `Needs review: ${decision.reasons.join("; ")}.`
      : `Ready: ${(state.requestReason ?? "all checks passed").replace(/\.+$/, "")}.`;

    await step("route", "policy", {
      requested: state.requested,
      final: status,
      overridden: decision.overridden || failed,
      reasons: decision.reasons,
    });

    const ms = now() - started;
    await store.moveToBottom(itemId, status);
    const updated: Item | null = await store.updateItem(itemId, {
      category: state.classification?.category ?? null,
      priority: state.classification?.priority ?? null,
      confidence: state.classification?.confidence ?? null,
      extracted: state.extracted ?? null,
      customer_id: state.customer?.id ?? null,
      draft_reply: state.draft ?? null,
      route_reason: reason,
      agent_ms: ms,
      processed_at: new Date(now()).toISOString(),
    });
    await store.finishRun(runId, {
      status: failed ? "failed" : "succeeded",
      inputTokens: usage.input,
      outputTokens: usage.output,
      error,
    });
    if (updated) emit({ type: "item", item: updated });
    emit({ type: "done", status, ms });
    return { status, ms, runId };
  }
}

/** Turns API and network failures into a sentence a non-technical user can act on. */
export function friendlyError(err: unknown): string {
  const status = typeof err === "object" && err && "status" in err ? Number((err as { status: unknown }).status) : NaN;
  const name = err instanceof Error ? err.name : "";
  const detail = err instanceof Error ? err.message : String(err);
  if (status === 429 || status === 529 || /overloaded|rate_limit/i.test(detail))
    return "The AI service is busy right now. Try again in a minute.";
  if (status === 401 || status === 403) return "The AI service isn't set up correctly. Ask your administrator.";
  if (/Timeout|Connection/.test(name) || /timed out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(detail))
    return "The AI service didn't respond in time. Try again.";
  return "Something went wrong while processing this item. Try again, or handle it manually.";
}

