import type { Category, Status } from "./types";

export const CONFIDENCE_THRESHOLD = 0.75;
export const INVOICE_REVIEW_AMOUNT = 5000;
/** Categories that may come from someone who isn't a customer yet. */
export const NEW_CUSTOMER_OK: Category[] = ["enquiry", "quote_request", "service_request"];

export interface RouteInput {
  /** Column the agent asked for (null if it never called move_card). */
  requested: Status | null;
  confidence: number | null | undefined;
  category: Category | null | undefined;
  customerFound: boolean;
  amount?: number | null;
  hasDraft: boolean;
}

export interface RouteDecision {
  status: Extract<Status, "needs_review" | "ready">;
  reasons: string[];
  /** True when the policy put the card somewhere other than where the agent asked. */
  overridden: boolean;
}

/**
 * The human checkpoint. Deterministic code, not the model, decides whether an
 * item may skip human review. The agent can only ever land a card in
 * "ready" or "needs_review"; moving to "done" is reserved for a person.
 */
export function decideRoute(input: RouteInput): RouteDecision {
  const reasons: string[] = [];

  if (input.confidence == null) reasons.push("the request type wasn't worked out");
  else if (input.confidence < CONFIDENCE_THRESHOLD)
    reasons.push(`the assistant was only ${Math.round(input.confidence * 100)}% sure of the request type`);

  // New customers asking questions or for quotes are normal sales leads. Unknown senders
  // only need a person when money, disputes or unclear requests are involved.
  if (!input.customerFound && !NEW_CUSTOMER_OK.includes(input.category as Category))
    reasons.push("the sender isn't an existing customer");
  if (input.category === "complaint") reasons.push("complaints are always checked by staff");
  if (input.category === "invoice" && (input.amount ?? 0) > INVOICE_REVIEW_AMOUNT)
    reasons.push(`the invoice is over $${INVOICE_REVIEW_AMOUNT.toLocaleString("en-AU")}`);
  if (!input.hasDraft) reasons.push("no reply was drafted");
  if (input.requested === "needs_review") reasons.push("the assistant flagged it for a check");

  const status = reasons.length === 0 ? "ready" : "needs_review";
  const overridden = input.requested != null && input.requested !== status;
  return { status, reasons, overridden };
}
