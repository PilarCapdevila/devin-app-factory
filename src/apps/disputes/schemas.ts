import { z } from "zod";
import { DISPUTE_PII_FIELDS, DISPUTE_STATUSES, PROPOSALS } from "./types";

export const listDisputesInput = z.strictObject({
  status: z.enum(DISPUTE_STATUSES).optional(),
  due: z.enum(["overdue", "due_soon", "on_track"]).optional(),
});

export const assignInput = z.strictObject({
  analystId: z.string().min(1),
});

export const proposeInput = z.strictObject({
  proposal: z.enum(PROPOSALS),
  note: z.string().trim().min(1).max(2000),
  evidenceSummary: z.string().trim().min(20).max(4000).optional(),
});

export const revealInput = z.strictObject({
  field: z.enum(DISPUTE_PII_FIELDS),
  reason: z.string().trim().min(10).max(2000),
});
