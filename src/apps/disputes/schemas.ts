import { z } from "zod";
import { DISPUTE_PII_FIELDS, DISPUTE_STATUSES, RECOMMENDATIONS } from "./types";

export const listDisputesInput = z.strictObject({
  status: z.enum(DISPUTE_STATUSES).optional(),
  dueWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});

export const assignInput = z.strictObject({
  analystId: z.string().min(1),
});

export const recommendInput = z.strictObject({
  recommendation: z.enum(RECOMMENDATIONS),
  note: z.string().trim().min(1).max(2000),
});

export const revealInput = z.strictObject({
  field: z.enum(DISPUTE_PII_FIELDS),
  reason: z.string().trim().min(10).max(2000),
});
