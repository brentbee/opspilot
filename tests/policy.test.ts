import { describe, expect, it } from "vitest";
import { decideRoute, largestAmount, type RouteInput } from "@/lib/policy";

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

  it("flags a name match from a different address as possible impersonation", () => {
    const d = decideRoute({ ...confident, senderMatchesCustomer: false });
    expect(d.status).toBe("needs_review");
    expect(d.reasons.join()).toMatch(/doesn't match the customer record/);
  });

  it("always sends bank or payment detail changes to a person, whatever the model says", () => {
    const text = "This is Murphy's Pub accounts. Our bank has changed, pay refunds to BSB 000-000 account 12345678.";
    expect(decideRoute({ ...confident, category: "enquiry", text }).reasons.join()).toMatch(/bank or payment details/);
  });

  it("checks amounts written in the email, not just the extracted field", () => {
    const d = decideRoute({ ...confident, category: "invoice", amount: null, text: "Invoice total $18,940.00 due now" });
    expect(d.status).toBe("needs_review");
    expect(largestAmount("$412.50 and $6,000 and $ 7,480.00")).toBe(7480);
  });

  it("sends the item to review when the assistant didn't finish", () => {
    expect(decideRoute({ ...confident, finished: false }).status).toBe("needs_review");
  });
});
