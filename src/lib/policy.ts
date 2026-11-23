import type { Category, Status } from "./types";

export const CONFIDENCE_THRESHOLD = 0.75;
export const INVOICE_REVIEW_AMOUNT = 5000;
/** Categories that may come from someone who isn't a customer yet. */
export const NEW_CUSTOMER_OK: Category[] = ["enquiry", "quote_request", "service_request"];

/** Deterministic red flags in the email text, checked by code regardless of what the model says. */
const BANK_DETAILS = /\b(bank(ing)? details|bsb|account (number|details)|payment details|remit(tance)? to|new account)\b/i;
const MONEY = /\$\s?(\d{1,3}(,\d{3})+|\d+)(\.\d{2})?/g;

/** Largest dollar amount written in the text, if any. */
export function largestAmount(text: string): number | null {
  let max: number | null = null;
  for (const m of text.matchAll(MONEY)) {
    const n = Number(m[0].replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && (max == null || n > max)) max = n;
  }
  return max;
}

export interface RouteInput {
  /** Column the agent asked for (null if it never called move_card). */
  requested: Status | null;
  confidence: number | null | undefined;
  category: Category | null | undefined;
  customerFound: boolean;
  /** The matched customer's email is the address the email actually came from. */
  senderMatchesCustomer?: boolean;
  /** The agent completed its steps (called move_card) rather than stopping early. */
  finished?: boolean;
  /** Raw subject + body, for deterministic checks. */
  text?: string;
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
  // A name/company match from a different address could be impersonation.
  if (input.customerFound && input.senderMatchesCustomer === false)
    reasons.push("the sender's email doesn't match the customer record");
  if (input.text && BANK_DETAILS.test(input.text)) reasons.push("it mentions bank or payment details");
  if (input.category === "complaint") reasons.push("complaints are always checked by staff");
  const amount = Math.max(input.amount ?? 0, input.text ? (largestAmount(input.text) ?? 0) : 0);
  if ((input.category === "invoice" || input.category === "other") && amount > INVOICE_REVIEW_AMOUNT)
    reasons.push(`the amount is over $${INVOICE_REVIEW_AMOUNT.toLocaleString("en-AU")}`);
  if (!input.hasDraft) reasons.push("no reply was drafted");
  if (input.requested === "needs_review") reasons.push("the assistant flagged it for a check");
  if (input.finished === false) reasons.push("the assistant didn't finish all its steps");

  const status = reasons.length === 0 ? "ready" : "needs_review";
  const overridden = input.requested != null && input.requested !== status;
  return { status, reasons, overridden };
}
