import type { DisputeStatus, DueState, Proposal } from "../types";

export type DisputeSummary = {
  id: string;
  caseReference: string;
  paymentReference: string;
  amountCents: number;
  currency: string;
  paymentDate: string;
  reasonCode: string;
  customerStatement: string;
  cardholderName: string;
  cardLast4: string;
  customerEmail: string;
  respondBy: string;
  status: DisputeStatus;
  proposal: Proposal | null;
  evidenceSummary: string | null;
  dueState: DueState;
  assignedToId: string | null;
  assignedTo: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
};

export const STATUS_STYLES: Record<DisputeStatus, string> = {
  NEW: "bg-slate-100 text-slate-700",
  IN_REVIEW: "bg-blue-100 text-blue-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-red-100 text-red-800",
  CHALLENGED: "bg-emerald-100 text-emerald-800",
};

export const DUE_STYLES: Record<DueState, string> = {
  overdue: "bg-red-700 text-white",
  due_soon: "bg-amber-500 text-white",
  on_track: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-500",
};

export const DUE_LABELS: Record<DueState, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "On track",
  closed: "Closed",
};

export const PROPOSAL_LABELS: Record<Proposal, string> = {
  accept: "Accept dispute (refund the chargeback)",
  fight: "Fight dispute (submit evidence)",
};

export function formatAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amountCents / 100);
}

export function formatReason(reasonCode: string): string {
  return reasonCode.replace(/_/g, " ");
}

/** Human-readable time remaining until (or elapsed since) the response deadline. */
export function timeRemaining(respondBy: string, now: Date = new Date()): string {
  const ms = new Date(respondBy).getTime() - now.getTime();
  const hours = Math.round(Math.abs(ms) / (60 * 60 * 1000));
  const span = hours >= 48 ? `${Math.round(hours / 24)} d` : `${hours} h`;
  return ms < 0 ? `${span} overdue` : `${span} left`;
}
