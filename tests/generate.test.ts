import { describe, expect, it } from "vitest";
import { SCENARIOS, generateEmails, generatorPrompt, pickCards } from "@/agent/generate";
import type { Customer } from "@/lib/types";

const customers: Customer[] = Array.from({ length: 5 }, (_, i) => ({
  id: `c${i}`,
  name: `Person ${i}`,
  company: `Co ${i}`,
  email: `p${i}@co.example`,
  tier: "standard",
  notes: null,
  created_at: "",
}));

/** Deterministic PRNG so tests are stable. */
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe("pickCards", () => {
  it("gives 10 distinct scenarios with a mix of known and new senders", () => {
    const cards = pickCards(customers, 10, seeded(42));
    expect(cards).toHaveLength(10);
    expect(new Set(cards.map((c) => c.scenario)).size).toBe(10);
    cards.forEach((c) => expect(SCENARIOS).toContain(c.scenario));
    const known = cards.filter((c) => c.sender).length;
    expect(known).toBeGreaterThan(0);
    expect(known).toBeLessThan(10);
  });

  it("works with no customers", () => {
    expect(pickCards([], 3, seeded(1)).every((c) => c.sender === null)).toBe(true);
  });

  it("puts sender details into the prompt", () => {
    const prompt = generatorPrompt([{ scenario: "a complaint", sender: customers[0] }], "1 Dec 2026");
    expect(prompt).toContain("Person 0 of Co 0 <p0@co.example>");
    expect(prompt).toContain("exactly 1 emails");
  });
});

describe("generateEmails", () => {
  it("returns validated emails and drops malformed ones", async () => {
    const good = { from_name: "A", from_email: "a@x.example", subject: "Hi", body: "Body" };
    const emails = await generateEmails(customers, 3, async () => ({
      emails: [good, { from_name: "", subject: "x" }, { ...good, subject: "Two" }],
    }));
    expect(emails.map((e) => e.subject)).toEqual(["Hi", "Two"]);
  });

  it("caps the batch at the requested count", async () => {
    const good = { from_name: "A", from_email: "", subject: "S", body: "B" };
    expect(await generateEmails(customers, 2, async () => ({ emails: [good, good, good] }))).toHaveLength(2);
  });

  it("fails clearly on an unexpected shape", async () => {
    await expect(generateEmails(customers, 2, async () => ({ nope: true }))).rejects.toThrow(/unexpected format/);
  });
});
