export const REFUND_STATUSES = ["PENDING_APPROVAL", "ISSUED", "RETURNED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_ENTITY_TYPE = "refunds.refund";
export const REFUND_ISSUE_ACTION = "refunds.issue";

export const CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Payload stored on the approval request so the approver sees what will be issued. */
export type RefundIssuePayload = { paymentId: string; amountCents: number; currency: string };
