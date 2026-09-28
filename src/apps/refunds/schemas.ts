import { z } from "zod";
import { PII_FIELD_NAMES } from "@/platform/pii";
import { CURRENCIES, REFUND_STATUSES } from "./types";

const amountCents = z.coerce.number().int().min(0);

export const listRefundsInput = z.strictObject({
  status: z.enum(REFUND_STATUSES).optional(),
  minAmountCents: amountCents.optional(),
  maxAmountCents: amountCents.optional(),
});

export const requestRefundInput = z.strictObject({
  paymentId: z.string().trim().min(1).max(64),
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.email().trim().max(254),
  cardLast4: z.string().regex(/^\d{4}$/, "cardLast4 must be exactly 4 digits"),
  amountCents: z.number().int().min(1).max(100_000_000),
  currency: z.enum(CURRENCIES),
  reason: z.string().trim().min(1).max(2000),
});

export const revealInput = z.strictObject({
  field: z.enum(PII_FIELD_NAMES),
  reason: z.string().trim().min(10).max(2000),
});
