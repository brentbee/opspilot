import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, PRIORITIES, type Customer, type Extracted } from "@/lib/types";
import type { CustomerQuery } from "@/lib/repo";

/* ------------------------------- input schemas ------------------------------ */

export const extractFieldsInput = z.object({
  sender_name: z.string().optional().describe("Name of the person who sent the item"),
  sender_email: z.string().optional().describe("Sender email address, if present"),
  company: z.string().optional().describe("Sender's company or business name"),
  amount: z.number().optional().describe("Money amount mentioned (invoice total, budget), as a number"),
  currency: z.string().optional().describe("ISO currency code, e.g. AUD"),
  due_date: z.string().optional().describe("Due or requested-by date, ISO 8601 (YYYY-MM-DD)"),
  reference: z.string().optional().describe("Invoice number, PO number or order reference"),
  requested_items: z.array(z.string()).optional().describe("Products or services asked about"),
  summary: z.string().describe("One sentence: what the sender wants"),
});

export const classifyInput = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How sure you are of the category, 0 to 1. Be honest: ambiguous items should score low."),
  rationale: z.string().describe("One short sentence explaining the choice"),
});

export const lookupCustomerInput = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  company: z.string().optional(),
});

export const draftReplyInput = z.object({
  tone: z.enum(["friendly", "formal", "apologetic"]),
  key_points: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe("The points the reply must cover, in order"),
});

export const moveCardInput = z.object({
  status: z
    .enum(["ready", "needs_review"])
    .describe("ready = safe to send without a human; needs_review = a human should check first"),
  reason: z.string().describe("One short sentence"),
});

/* --------------------------------- run state -------------------------------- */

export interface Classification {
  category: z.infer<typeof classifyInput>["category"];
  priority: z.infer<typeof classifyInput>["priority"];
  confidence: number;
  rationale: string;
}

/** What the agent has established so far in this run. */
export interface RunState {
  extracted?: Extracted;
  classification?: Classification;
  customerLookedUp: boolean;
  customer: Customer | null;
  draft?: string;
  requested: "ready" | "needs_review" | null;
  requestReason?: string;
}

export function emptyState(): RunState {
  return { customerLookedUp: false, customer: null, requested: null };
}

/** Side effects the tools need; injected so tests can run without a DB or API. */
export interface ToolDeps {
  findCustomer(q: CustomerQuery): Promise<Customer | null>;
  /** Writes the reply, streaming tokens to the UI, and returns the full text. */
  writeDraft(args: z.infer<typeof draftReplyInput>, state: RunState): Promise<string>;
}

export interface ToolResult {
  /** Returned to the model as the tool_result content. */
  content: Record<string, unknown>;
  isError?: boolean;
}

/* ---------------------------------- tools ---------------------------------- */

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(input: z.infer<S>, state: RunState, deps: ToolDeps): Promise<ToolResult>;
}

function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export const TOOLS = [
  tool({
    name: "extract_fields",
    description:
      "Record the structured fields you extracted from the item. Call this first. Only include fields that are actually present; never invent values.",
    schema: extractFieldsInput,
    async run(input, state) {
      state.extracted = input;
      return { content: { recorded: true, fields: Object.keys(input) } };
    },
  }),
  tool({
    name: "classify",
    description: "Record the category, priority and your honest confidence for this item.",
    schema: classifyInput,
    async run(input, state) {
      state.classification = input;
      return { content: { recorded: true } };
    },
  }),
  tool({
    name: "lookup_customer",
    description:
      "Look the sender up in the customer database by email, name or company. Returns the customer record, or found=false.",
    schema: lookupCustomerInput,
    async run(input, state, deps) {
      if (!input.email && !input.name && !input.company)
        return { content: { error: "Provide at least one of email, name or company" }, isError: true };
      const customer = await deps.findCustomer(input);
      state.customerLookedUp = true;
      state.customer = customer;
      if (!customer) return { content: { found: false } };
      return {
        content: {
          found: true,
          customer: {
            name: customer.name,
            company: customer.company,
            email: customer.email,
            tier: customer.tier,
            notes: customer.notes,
          },
        },
      };
    },
  }),
  tool({
    name: "draft_reply",
    description:
      "Write the reply to the sender. A writer streams the actual text from your key points and the customer context. Call after lookup_customer.",
    schema: draftReplyInput,
    async run(input, state, deps) {
      const text = await deps.writeDraft(input, state);
      state.draft = text;
      return { content: { drafted: true, characters: text.length } };
    },
  }),
  tool({
    name: "move_card",
    description:
      "Request the board column for this item. Call last. The system applies a review policy and may route the item to needs_review regardless.",
    schema: moveCardInput,
    async run(input, state) {
      state.requested = input.status;
      state.requestReason = input.reason;
      return { content: { requested: input.status, note: "Final column is decided by the review policy." } };
    },
  }),
];

export type ToolName = (typeof TOOLS)[number]["name"];

/** Tool definitions in the shape the Anthropic Messages API expects. */
export function anthropicTools(): Anthropic.Tool[] {
  return TOOLS.map((t) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    void _ignored;
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
  });
}

/** Validates the model's input with zod, then runs the tool. Never throws. */
export async function runTool(
  name: string,
  rawInput: unknown,
  state: RunState,
  deps: ToolDeps,
): Promise<ToolResult> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { content: { error: `Unknown tool: ${name}` }, isError: true };
  const parsed = def.schema.safeParse(rawInput);
  if (!parsed.success)
    return {
      content: { error: "Invalid input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      isError: true,
    };
  try {
    // Each def is typed against its own schema; the union widens here.
    return await (def.run as (i: unknown, s: RunState, d: ToolDeps) => Promise<ToolResult>)(
      parsed.data,
      state,
      deps,
    );
  } catch (err) {
    return { content: { error: err instanceof Error ? err.message : String(err) }, isError: true };
  }
}
