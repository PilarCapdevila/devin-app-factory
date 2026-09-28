import type { CaseStatus } from "../types";

export type CaseSummary = {
  id: string;
  applicantName: string;
  dateOfBirth: string;
  nationalId: string;
  address: string;
  riskScore: number;
  riskFlags: string[];
  status: CaseStatus;
  assignedToId: string | null;
  assignedTo: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
};

export const STATUS_STYLES: Record<CaseStatus, string> = {
  NEW: "bg-slate-100 text-slate-700",
  IN_REVIEW: "bg-blue-100 text-blue-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
};

export function riskTone(score: number): string {
  if (score >= 75) return "text-red-700 font-semibold";
  if (score >= 40) return "text-amber-700 font-medium";
  return "text-emerald-700";
}
