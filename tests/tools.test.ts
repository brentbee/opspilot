import { describe, expect, it, vi } from "vitest";
import { anthropicTools, emptyState, runTool, type ToolDeps } from "@/agent/tools";
import type { Customer } from "@/lib/types";

const customer: Customer = {
  id: "c1",
  name: "Raj Patel",
  company: "Spice Route Kitchen",
  email: "raj@spiceroute.example",
  tier: "priority",
  notes: "4-hour SLA",
  created_at: "2026-11-01T00:00:00Z",
};

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
  return {
    findCustomer: vi.fn(async () => customer),
    writeDraft: vi.fn(async () => "Hi Raj, thanks..."),
    ...over,
  };
}

describe("tool definitions", () => {
  it("exposes the five tools with JSON schemas", () => {
    const tools = anthropicTools();
    expect(tools.map((t) => t.name)).toEqual(["extract_fields", "classify", "lookup_customer", "draft_reply", "move_card"]);
    for (const t of tools) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).not.toHaveProperty("$schema");
    }
  });
});

describe("runTool", () => {
  it("rejects invalid input without throwing, so the model can retry", async () => {
    const r = await runTool("classify", { category: "spam", priority: "normal", confidence: 2 }, emptyState(), deps());
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/category/);
  });

  it("rejects unknown tools", async () => {
    expect((await runTool("delete_everything", {}, emptyState(), deps())).isError).toBe(true);
  });

  it("records classification in run state", async () => {
    const s = emptyState();
    await runTool("classify", { category: "invoice", priority: "low", confidence: 0.9, rationale: "has an invoice number" }, s, deps());
    expect(s.classification).toMatchObject({ category: "invoice", confidence: 0.9 });
  });

  it("looks up customers and returns only safe fields", async () => {
    const s = emptyState();
    const r = await runTool("lookup_customer", { email: "raj@spiceroute.example" }, s, deps());
    expect(s.customer?.id).toBe("c1");
    expect(r.content).toMatchObject({ found: true, customer: { name: "Raj Patel", tier: "priority" } });
    expect(JSON.stringify(r.content)).not.toContain("c1");
  });

  it("requires at least one lookup key", async () => {
    const d = deps();
    expect((await runTool("lookup_customer", {}, emptyState(), d)).isError).toBe(true);
    expect(d.findCustomer).not.toHaveBeenCalled();
  });

  it("reports a missing customer", async () => {
    const s = emptyState();
    const r = await runTool("lookup_customer", { email: "x@y.example" }, s, deps({ findCustomer: async () => null }));
    expect(r.content).toEqual({ found: false });
    expect(s.customerLookedUp).toBe(true);
  });

  it("turns a dependency failure into a tool error", async () => {
    const r = await runTool(
      "draft_reply",
      { tone: "friendly", key_points: ["thanks"] },
      emptyState(),
      deps({ writeDraft: async () => Promise.reject(new Error("API down")) }),
    );
    expect(r).toEqual({ content: { error: "API down" }, isError: true });
  });

  it("move_card only records a request; it cannot pick 'done'", async () => {
    const s = emptyState();
    expect((await runTool("move_card", { status: "done", reason: "x" }, s, deps())).isError).toBe(true);
    await runTool("move_card", { status: "ready", reason: "all good" }, s, deps());
    expect(s.requested).toBe("ready");
  });
});
