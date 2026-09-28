import type { DisputeStatus } from "../types";

export type DisputeSummary = {
  id: string;
  merchantName: string;
  amountMinor: number;
  currency: string;
  reasonCode: string;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  cardLast4: string;
  responseDeadline: string;
  status: DisputeStatus;
  assignedToId: string | null;
  assignedTo: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
};

export const STATUS_STYLES: Record<DisputeStatus, string> = {
  NEW: "bg-slate-100 text-slate-700",
  IN_REVIEW: "bg-blue-100 text-blue-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-emerald-100 text-emerald-800",
  CONTESTED: "bg-purple-100 text-purple-800",
};

/** Days until the respond-by deadline; negative means overdue. */
export function daysUntil(deadline: string | Date): number {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

const OPEN_STATUSES: readonly DisputeStatus[] = ["NEW", "IN_REVIEW", "PENDING_APPROVAL"];

export function deadlineLabel(deadline: string | Date): string {
  const days = daysUntil(deadline);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d left`;
}

/** Highlight urgency on open disputes: overdue red, due within 3 days amber, otherwise normal. */
export function deadlineTone(deadline: string | Date, status: DisputeStatus): string {
  if (!OPEN_STATUSES.includes(status)) return "text-slate-500";
  const days = daysUntil(deadline);
  if (days < 0) return "text-red-700 font-semibold";
  if (days <= 3) return "text-amber-700 font-medium";
  return "text-slate-700";
}

export function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(amountMinor / 100);
}
