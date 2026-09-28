export const DISPUTE_STATUSES = ["NEW", "IN_REVIEW", "PENDING_APPROVAL", "ACCEPTED", "CHALLENGED"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const PROPOSALS = ["accept", "fight"] as const;
export type Proposal = (typeof PROPOSALS)[number];

export const DUE_STATES = ["overdue", "due_soon", "on_track", "closed"] as const;
export type DueState = (typeof DUE_STATES)[number];

/** Disputes whose response deadline is within this window are flagged as due soon. */
export const DUE_SOON_HOURS = 72;

/** The dispute PII fields; the only ones the reveal route accepts. `cardLast4` is deliberately not PII. */
export const DISPUTE_PII_FIELDS = ["cardholderName", "customerEmail"] as const;
export type DisputePiiField = (typeof DISPUTE_PII_FIELDS)[number];

export const DISPUTES_ENTITY_TYPE = "disputes.dispute";
export const DISPUTES_DECISION_ACTION = "disputes.decision";
