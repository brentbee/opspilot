import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { friendlyError, runAgent, type AgentStore } from "@/agent/runAgent";
import type { AgentLLM } from "@/agent/llm";
import { DEFAULT_BUSINESS } from "@/lib/business";
import type { AgentEvent, Customer, Item, Step } from "@/lib/types";

/* ----------------------------- test doubles ----------------------------- */

const CUSTOMER: Customer = {
  id: "c1",
  name: "Raj Patel",
  company: "Spice Route Kitchen",
  email: "raj@spiceroute.example",
  tier: "priority",
  notes: null,
  created_at: "2026-11-01T00:00:00Z",
};

function memoryStore(item: Partial<Item> = {}) {
  const state = {
    item: {
      id: "i1",
      subject: "Quote for a second combi oven",
      body: "Can you quote a second combi oven?",
      from_name: "Raj Patel",
      from_email: "raj@spiceroute.example",
      status: "new",
      position: 1024,
      category: null,
      priority: null,
      confidence: null,
      extracted: null,
      customer_id: null,
      draft_reply: null,
      route_reason: null,
      agent_ms: null,
      created_at: "",
      updated_at: "",
      processed_at: null,
      ...item,
    } as Item,
    steps: [] as Step[],
    run: null as null | { status: string; inputTokens: number; outputTokens: number; error?: string },
  };
  const store: AgentStore = {
    getItem: async () => state.item,
    updateItem: async (_id, patch) => (state.item = { ...state.item, ...patch } as Item),
    moveToBottom: async (_id, status) => {
      state.item.status = status;
      return 2048;
    },
    startRun: async () => "run1",
    finishRun: async (_id, r) => void (state.run = r),
    insertStep: async (s) => {
      const saved = { ...s, id: state.steps.length + 1 };
      state.steps.push(saved);
      return saved;
    },
    findCustomer: async (q) => (q.email === CUSTOMER.email ? CUSTOMER : null),
    getBusiness: async () => DEFAULT_BUSINESS,
  };
  return { store, state };
}

let n = 0;
const call = (name: string, input: Record<string, unknown>): Anthropic.ToolUseBlock =>
  ({ type: "tool_use", id: `tu_${++n}`, name, input }) as Anthropic.ToolUseBlock;

function message(content: Anthropic.ContentBlock[], stop: Anthropic.StopReason = "tool_use"): Anthropic.Message {
  return {
    id: `msg_${++n}`,
    type: "message",
    role: "assistant",
    model: "fake",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  } as unknown as Anthropic.Message;
}

/** Replays a fixed script of agent turns and records what it was sent. */
function scriptedLLM(turns: Anthropic.Message[], draft = "Hi Raj,\n\nThanks for your enquiry.") {
  const seen: Anthropic.MessageParam[][] = [];
  const llm: AgentLLM = {
    model: "fake-model",
    async turn(req) {
      seen.push(structuredClone(req.messages));
      const next = turns.shift();
      if (!next) throw new Error("script exhausted");
      return next;
    },
    async streamText(_req, onText) {
      for (const word of draft.split(/(?<= )/)) onText(word);
      return { text: draft, usage: { input: 50, output: 30 } };
    },
  };
  return { llm, seen };
}

const happyPath = (confidence = 0.92) => [
  message([
    { type: "text", text: "Extracting the request first.", citations: null } as Anthropic.TextBlock,
    call("extract_fields", { sender_name: "Raj Patel", summary: "Wants a quote for a second combi oven", requested_items: ["combi oven"] }),
  ]),
  message([call("classify", { category: "quote_request", priority: "normal", confidence, rationale: "Asks for a quote" })]),
  message([call("lookup_customer", { email: "raj@spiceroute.example" })]),
  message([call("draft_reply", { tone: "friendly", key_points: ["thank them", "quote to follow"] })]),
  message([call("move_card", { status: "ready", reason: "Simple quote for a known customer" })]),
];

/* --------------------------------- tests -------------------------------- */

describe("runAgent", () => {
  it("runs the full tool loop, streams steps and tokens, and routes to Ready", async () => {
    const { store, state } = memoryStore();
    const { llm } = scriptedLLM(happyPath());
    const events: AgentEvent[] = [];

    const res = await runAgent({ itemId: "i1", llm, store, emit: (e) => events.push(e) });

    expect(res.status).toBe("ready");
    expect(state.item).toMatchObject({
      status: "ready",
      category: "quote_request",
      customer_id: "c1",
      draft_reply: "Hi Raj,\n\nThanks for your enquiry.",
    });
    expect(state.steps.filter((s) => s.kind === "tool_call").map((s) => s.tool)).toEqual([
      "extract_fields",
      "classify",
      "lookup_customer",
      "draft_reply",
      "move_card",
    ]);
    expect(state.steps.at(-1)).toMatchObject({ kind: "route", payload: { final: "ready", overridden: false } });
    expect(state.steps[0]).toMatchObject({ kind: "thought" });

    // Streamed to the UI in order: run → steps/tokens → item → done.
    expect(events[0]).toMatchObject({ type: "run", runId: "run1" });
    expect(events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("")).toBe(
      "Hi Raj,\n\nThanks for your enquiry.",
    );
    expect(events.at(-1)).toMatchObject({ type: "done", status: "ready" });
    expect(state.run).toMatchObject({ status: "succeeded", inputTokens: 550, outputTokens: 130 });
  });

  it("stops calling the model once move_card is done", async () => {
    const { store } = memoryStore();
    const turns = happyPath();
    const { llm, seen } = scriptedLLM(turns);
    await runAgent({ itemId: "i1", llm, store, emit: () => {} });
    expect(seen).toHaveLength(5);
  });

  it("feeds tool results back to the model, paired by tool_use id", async () => {
    const { store } = memoryStore();
    const { llm, seen } = scriptedLLM(happyPath());
    await runAgent({ itemId: "i1", llm, store, emit: () => {} });
    const lastUser = seen[3].at(-1)!;
    expect(lastUser.role).toBe("user");
    const block = (lastUser.content as Anthropic.ToolResultBlockParam[])[0];
    expect(block.type).toBe("tool_result");
    expect(JSON.parse(block.content as string)).toMatchObject({ found: true });
  });

  it("lets the policy override the agent when confidence is low", async () => {
    const { store, state } = memoryStore();
    const { llm } = scriptedLLM(happyPath(0.55));
    const res = await runAgent({ itemId: "i1", llm, store, emit: () => {} });
    expect(res.status).toBe("needs_review");
    expect(state.steps.at(-1)?.payload).toMatchObject({ requested: "ready", final: "needs_review", overridden: true });
    expect(state.item.route_reason).toMatch(/only 55% sure/);
  });

  it("recovers from a bad tool call by returning the error to the model", async () => {
    const { store, state } = memoryStore();
    const turns = happyPath();
    turns.splice(1, 0, message([call("classify", { category: "nonsense" })]));
    const { llm } = scriptedLLM(turns);
    const res = await runAgent({ itemId: "i1", llm, store, emit: () => {} });
    expect(state.steps.some((s) => s.kind === "tool_result" && s.payload.is_error)).toBe(true);
    expect(res.status).toBe("ready");
  });

  it("routes to review and marks the run failed when the model errors", async () => {
    const { store, state } = memoryStore();
    const { llm } = scriptedLLM(happyPath().slice(0, 2)); // script runs out → throws
    const events: AgentEvent[] = [];
    const res = await runAgent({ itemId: "i1", llm, store, emit: (e) => events.push(e) });
    expect(res.status).toBe("needs_review");
    expect(state.run?.status).toBe("failed");
    expect(state.item.route_reason).toMatch(/couldn't finish/);
    expect(state.run?.error).toMatch(/script exhausted/);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("finishes when the model ends its turn without move_card", async () => {
    const { store, state } = memoryStore();
    const turns = happyPath().slice(0, 4);
    turns.push(message([{ type: "text", text: "Done.", citations: null } as Anthropic.TextBlock], "end_turn"));
    const { llm } = scriptedLLM(turns);
    const res = await runAgent({ itemId: "i1", llm, store, emit: () => {} });
    expect(res.status).toBe("ready");
    expect(state.steps.at(-1)?.payload).toMatchObject({ requested: null, final: "ready" });
  });

  it("enforces the time budget", async () => {
    const { store, state } = memoryStore();
    const { llm } = scriptedLLM(happyPath());
    let t = 0;
    const res = await runAgent({ itemId: "i1", llm, store, emit: () => {}, now: () => (t += 20_000) });
    expect(res.status).toBe("needs_review");
    expect(state.steps.some((s) => s.kind === "error" && String(s.payload.message).includes("took too long"))).toBe(true);
  });
});

describe("friendlyError", () => {
  it.each([
    ['429 {"type":"error","error":{"type":"rate_limit_error"}}', /busy/],
    ["401 invalid x-api-key", /set up correctly/],
    ["Request timed out.", /didn't respond/],
    ["weird", /Something went wrong/],
  ])("maps %s", (detail, expected) => expect(friendlyError(detail)).toMatch(expected));
});
