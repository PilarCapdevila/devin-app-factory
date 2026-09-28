export const DISPUTE_STATUSES = ["NEW", "IN_REVIEW", "PENDING_APPROVAL", "ACCEPTED", "CONTESTED"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const RECOMMENDATIONS = ["accept", "contest"] as const;
export type DisputeRecommendation = (typeof RECOMMENDATIONS)[number];

export const DISPUTE_PII_FIELDS = ["customerEmail", "customerAddress"] as const;
export type DisputePiiField = (typeof DISPUTE_PII_FIELDS)[number];

export const DISPUTE_ENTITY_TYPE = "disputes.dispute";
export const DISPUTE_DECISION_ACTION = "disputes.decision";
