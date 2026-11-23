export const STATUSES = ["new", "processing", "needs_review", "ready", "done"] as const;
export type Status = (typeof STATUSES)[number];

/** Columns shown on the board. "processing" is transient and rendered inside "New". */
export const BOARD_COLUMNS: { status: Status; title: string; hint: string }[] = [
  { status: "new", title: "New", hint: "Waiting for the agent" },
  { status: "needs_review", title: "Needs review", hint: "A human must check" },
  { status: "ready", title: "Ready to send", hint: "Agent is confident" },
  { status: "done", title: "Done", hint: "Sent / closed by a human" },
];

export const CATEGORIES = ["enquiry", "quote_request", "invoice", "complaint", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Customer {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  tier: "standard" | "priority";
  notes: string | null;
  created_at: string;
}

export interface Extracted {
  sender_name?: string;
  sender_email?: string;
  company?: string;
  amount?: number;
  currency?: string;
  due_date?: string;
  reference?: string;
  requested_items?: string[];
  summary?: string;
}

export interface Item {
  id: string;
  subject: string;
  body: string;
  from_name: string | null;
  from_email: string | null;
  status: Status;
  position: number;
  category: Category | null;
  priority: Priority | null;
  confidence: number | null;
  extracted: Extracted | null;
  customer_id: string | null;
  customer_name?: string | null;
  draft_reply: string | null;
  route_reason: string | null;
  agent_ms: number | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export type StepKind =
  | "thought"
  | "tool_call"
  | "tool_result"
  | "draft"
  | "route"
  | "error"
  | "human_override";

export interface Step {
  id?: number;
  run_id: string | null;
  item_id: string;
  seq: number;
  kind: StepKind;
  tool: string | null;
  payload: Record<string, unknown>;
  created_at?: string;
}

/** Events sent to the browser over the SSE stream of POST /api/items/:id/run. */
export type AgentEvent =
  | { type: "run"; runId: string; model: string }
  | { type: "step"; step: Step }
  | { type: "token"; text: string }
  | { type: "item"; item: Item }
  | { type: "done"; status: Status; ms: number }
  | { type: "error"; message: string };
