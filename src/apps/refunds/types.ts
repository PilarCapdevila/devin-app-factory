export const REFUND_STATUSES = ["PENDING_APPROVAL", "ISSUED", "RETURNED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_ENTITY_TYPE = "refunds.refund";
export const REFUND_ISSUE_ACTION = "refunds.issue";

/** Refunds strictly above this amount need two different approvers; up to and including it, one. */
export const TWO_APPROVER_THRESHOLD_CENTS = 200_000;

export function requiredApprovalsForAmount(amountCents: number): number {
  return amountCents > TWO_APPROVER_THRESHOLD_CENTS ? 2 : 1;
}

export const CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Payload stored on the approval request so the approver sees what will be issued. */
export type RefundIssuePayload = { paymentId: string; amountCents: number; currency: string };
