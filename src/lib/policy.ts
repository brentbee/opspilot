import type { Category, Status } from "./types";

export const CONFIDENCE_THRESHOLD = 0.75;
export const INVOICE_REVIEW_AMOUNT = 5000;

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

  if (input.confidence == null) reasons.push("no classification confidence");
  else if (input.confidence < CONFIDENCE_THRESHOLD)
    reasons.push(`confidence ${input.confidence.toFixed(2)} is below ${CONFIDENCE_THRESHOLD}`);

  if (!input.customerFound) reasons.push("sender is not a known customer");
  if (input.category === "complaint") reasons.push("complaints always go to a human");
  if (input.category === "invoice" && (input.amount ?? 0) > INVOICE_REVIEW_AMOUNT)
    reasons.push(`invoice is over $${INVOICE_REVIEW_AMOUNT.toLocaleString("en-AU")}`);
  if (!input.hasDraft) reasons.push("no draft reply was written");
  if (input.requested === "needs_review") reasons.push("the agent asked for a review");

  const status = reasons.length === 0 ? "ready" : "needs_review";
  const overridden = input.requested != null && input.requested !== status;
  return { status, reasons, overridden };
}
