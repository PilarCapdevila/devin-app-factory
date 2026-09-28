import type { RefundStatus } from "../types";

export type RefundSummary = {
  id: string;
  paymentId: string;
  customerName: string;
  customerEmail: string;
  cardLast4: string;
  amountCents: number;
  currency: string;
  reason: string;
  status: RefundStatus;
  requestedById: string;
  requestedBy: { id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
};

export type RefundTotals = {
  pending: { count: number; totalCents: number };
  issuedToday: { count: number; totalCents: number };
};

export const STATUS_STYLES: Record<RefundStatus, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  ISSUED: "bg-emerald-100 text-emerald-800",
  RETURNED: "bg-slate-200 text-slate-700",
};

export function formatMoney(amountCents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}

/** Parses a whole-currency amount typed by the user ("15", "5,000.50") into cents. */
export function parseAmountToCents(text: string): number | null {
  const cleaned = text.replace(/[,\s$]/g, "");
  if (cleaned === "" || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
