export const CASE_STATUSES = ["NEW", "IN_REVIEW", "PENDING_APPROVAL", "APPROVED", "REJECTED"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const RECOMMENDATIONS = ["approve", "reject"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const KYC_ENTITY_TYPE = "kyc.case";
export const KYC_DECISION_ACTION = "kyc.decision";
