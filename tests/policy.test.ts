import { describe, expect, it } from "vitest";
import { decideRoute, type RouteInput } from "@/lib/policy";

const confident: RouteInput = {
  requested: "ready",
  confidence: 0.92,
  category: "quote_request",
  customerFound: true,
  amount: null,
  hasDraft: true,
};

describe("decideRoute (the human checkpoint)", () => {
  it("lets a confident, known-customer item with a draft go to Ready", () => {
    expect(decideRoute(confident)).toEqual({ status: "ready", reasons: [], overridden: false });
  });

  it("sends low confidence to review and records that it overrode the agent", () => {
    const d = decideRoute({ ...confident, confidence: 0.6 });
    expect(d.status).toBe("needs_review");
    expect(d.overridden).toBe(true);
    expect(d.reasons[0]).toMatch(/only 60% sure/);
  });

  it("treats exactly the threshold as confident", () => {
    expect(decideRoute({ ...confident, confidence: 0.75 }).status).toBe("ready");
  });

  it.each([
    ["unknown sender with an invoice", { customerFound: false, category: "invoice" as const }],
    ["unknown sender with an unclear request", { customerFound: false, category: "other" as const }],
    ["complaint", { category: "complaint" as const }],
    ["large invoice", { category: "invoice" as const, amount: 18_940 }],
    ["missing draft", { hasDraft: false }],
    ["missing confidence", { confidence: null }],
  ])("routes %s to review", (_label, patch) => {
    expect(decideRoute({ ...confident, ...patch }).status).toBe("needs_review");
  });

  it.each(["enquiry", "quote_request", "service_request"] as const)("lets a new customer's %s through", (category) => {
    expect(decideRoute({ ...confident, customerFound: false, category }).status).toBe("ready");
  });

  it("allows small invoices through", () => {
    expect(decideRoute({ ...confident, category: "invoice", amount: 412.5 }).status).toBe("ready");
  });

  it("respects the agent asking for review even when everything else passes", () => {
    const d = decideRoute({ ...confident, requested: "needs_review" });
    expect(d).toMatchObject({ status: "needs_review", overridden: false });
  });

  it("still routes when the agent never called move_card", () => {
    const d = decideRoute({ ...confident, requested: null });
    expect(d).toMatchObject({ status: "ready", overridden: false });
  });
});
