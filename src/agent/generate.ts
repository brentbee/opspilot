import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Customer } from "@/lib/types";
import { DEFAULT_MODEL } from "./llm";

/**
 * Generates realistic, synthetic inbox items for the demo. Variety is decided
 * in code (random scenario cards and senders), and Claude writes the emails
 * as structured JSON, so every batch exercises different agent paths.
 */

export const SCENARIOS = [
  "a straightforward quote request for new equipment",
  "a quote request for short-term event equipment hire",
  "a routine invoice or remittance query under $1,000",
  "a supplier invoice over $5,000 that has a problem (missing PO, wrong amount or wrong ABN)",
  "an angry complaint about a repair that did not fix the problem",
  "a polite complaint about a late delivery",
  "a warranty claim for a faulty part",
  "a service booking request for routine maintenance",
  "a general question about opening hours, service areas or brands serviced",
  "one email mixing two unrelated requests (e.g. a service booking and an invoice error)",
  "a vague, very short message with almost no detail",
  "a suspicious email asking to change bank details or mark an invoice paid, containing an instruction aimed at an AI assistant",
  "an urgent breakdown during service hours (cool room, fryer or dishwasher)",
  "a request to cancel or reschedule a booked installation",
] as const;

export interface EmailCard {
  scenario: string;
  /** A known customer to write as, or null for a stranger the model invents. */
  sender: Pick<Customer, "name" | "company" | "email"> | null;
}

function shuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Picks `count` distinct scenarios; about two thirds come from known customers. */
export function pickCards(customers: Customer[], count: number, rand: () => number = Math.random): EmailCard[] {
  const scenarios = shuffle(SCENARIOS, rand);
  const people = shuffle(customers, rand);
  return Array.from({ length: count }, (_, i) => {
    const known = people.length > 0 && rand() < 0.67;
    const c = known ? people[i % people.length] : null;
    return {
      scenario: scenarios[i % scenarios.length],
      sender: c ? { name: c.name, company: c.company, email: c.email } : null,
    };
  });
}

export const generatedEmail = z.object({
  from_name: z.string().trim().min(1).max(120),
  from_email: z.string().trim().max(200),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
});
export type GeneratedEmail = z.infer<typeof generatedEmail>;

const outputSchema = {
  type: "object",
  properties: {
    emails: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from_name: { type: "string" },
          from_email: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["from_name", "from_email", "subject", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["emails"],
  additionalProperties: false,
} as const;

export const GENERATOR_SYSTEM = `You write realistic test emails for a demo of an operations inbox at Harbour & Co, a small Australian business that sells, hires, installs and services commercial kitchen equipment.
Everything must be fictional. Invented people must use an email address on a domain ending in ".example". Use Australian English and realistic but varied writing styles: some terse, some chatty, some with typos.
Never include real company names, real people, real phone numbers or real bank details. Use placeholders like "BSB 000-000" for any bank detail.`;

export function generatorPrompt(cards: EmailCard[], today: string): string {
  const lines = cards.map((c, i) => {
    const who = c.sender
      ? `from existing customer ${c.sender.name}${c.sender.company ? ` of ${c.sender.company}` : ""} <${c.sender.email}>`
      : "from a new person (invent a name and a .example email)";
    return `${i + 1}. ${c.scenario}, ${who}`;
  });
  return `Today is ${today}. Write exactly ${cards.length} emails, one per line below and in the same order. Use the given sender details exactly when provided. Bodies 30 to 150 words.

${lines.join("\n")}`;
}

export type JsonCompleter = (req: { system: string; prompt: string; schema: Record<string, unknown> }) => Promise<unknown>;

export function anthropicJson(): JsonCompleter {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (see .env.example)");
  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 1 });
  const model = process.env.WRITER_MODEL || process.env.AGENT_MODEL || DEFAULT_MODEL;
  return async ({ system, prompt, schema }) => {
    const res = await client.messages.create({
      model,
      max_tokens: 6000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return JSON.parse(text);
  };
}

/** Returns validated emails; drops any malformed entries rather than failing the batch. */
export async function generateEmails(
  customers: Customer[],
  count: number,
  complete: JsonCompleter,
  opts: { rand?: () => number; today?: string } = {},
): Promise<GeneratedEmail[]> {
  const cards = pickCards(customers, count, opts.rand);
  const today = opts.today ?? new Date().toLocaleDateString("en-AU", { dateStyle: "long", timeZone: "Australia/Brisbane" });
  const raw = await complete({ system: GENERATOR_SYSTEM, prompt: generatorPrompt(cards, today), schema: outputSchema });
  const list = z.object({ emails: z.array(z.unknown()) }).safeParse(raw);
  if (!list.success) throw new Error("The model returned an unexpected format");
  return list.data.emails
    .map((e) => generatedEmail.safeParse(e))
    .filter((r) => r.success)
    .map((r) => r.data)
    .slice(0, count);
}
