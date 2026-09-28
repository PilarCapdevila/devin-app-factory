import { z } from "zod";
import { PII_FIELD_NAMES } from "@/platform/pii";
import { CASE_STATUSES, RECOMMENDATIONS } from "./types";

export const listCasesInput = z.strictObject({
  status: z.enum(CASE_STATUSES).optional(),
  minRisk: z.coerce.number().int().min(0).max(100).optional(),
  maxRisk: z.coerce.number().int().min(0).max(100).optional(),
});

export const assignInput = z.strictObject({
  analystId: z.string().min(1),
});

export const recommendInput = z.strictObject({
  recommendation: z.enum(RECOMMENDATIONS),
  note: z.string().trim().min(1).max(2000),
});

export const revealInput = z.strictObject({
  field: z.enum(PII_FIELD_NAMES),
  reason: z.string().trim().min(10).max(2000),
});
