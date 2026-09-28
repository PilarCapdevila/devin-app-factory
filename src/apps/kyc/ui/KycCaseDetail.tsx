"use client";

import { useEffect, useState } from "react";
import type { SessionUser } from "@/platform/auth";
import { can } from "@/platform/permissions";
import { ApprovalBar } from "@/platform/ui/ApprovalBar";
import { AuditTrail, type AuditTrailEvent } from "@/platform/ui/AuditTrail";
import { api, formatDate } from "@/platform/ui/client";
import { DetailPanel } from "@/platform/ui/DetailPanel";
import { MaskedField } from "@/platform/ui/MaskedField";
import { StatusBadge } from "./StatusBadge";
import { riskTone, type CaseSummary } from "./shared";

type ApprovalRequestView = {
  id: string;
  status: "PENDING" | "CONFIRMED" | "RETURNED";
  payload: { recommendation?: string } | null;
  requestNote: string;
  requestedAt: string;
  requestedById: string;
  requestedBy: { name: string };
  decidedBy: { name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

type CaseDetail = CaseSummary & { auditTrail: AuditTrailEvent[]; approvalRequests: ApprovalRequestView[] };
type Analyst = { id: string; name: string; email: string };

const PII_LABELS = { dateOfBirth: "Date of birth", nationalId: "National ID", address: "Address" } as const;

export function KycCaseDetail({ id, user, minRevealReasonLength }: { id: string; user: SessionUser; minRevealReasonLength: number }) {
  const [kycCase, setCase] = useState<CaseDetail | null>(null);
  const [analysts, setAnalysts] = useState<Analyst[]>([]);
  const [analystId, setAnalystId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const canAssignRole = can(user, "kyc.case.assign");

  useEffect(() => {
    api<CaseDetail>(`/api/kyc/cases/${id}`)
      .then(setCase)
      .catch((e: Error) => setError(e.message));
  }, [id, version]);

  useEffect(() => {
    if (canAssignRole) api<Analyst[]>("/api/kyc/analysts").then(setAnalysts).catch(() => setAnalysts([]));
  }, [canAssignRole]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!kycCase) return <p className="text-sm text-slate-500">Loading…</p>;

  const pending = kycCase.approvalRequests.find((r) => r.status === "PENDING");
  const canAssign = canAssignRole && (kycCase.status === "NEW" || kycCase.status === "IN_REVIEW");
  const canStart = can(user, "kyc.case.work") && kycCase.status === "NEW";
  const canRecommend = can(user, "kyc.case.work") && kycCase.status === "IN_REVIEW";
  const canDecide = can(user, "kyc.case.decide") && pending !== undefined && pending.requestedById !== user.id;

  async function post(path: string, body?: unknown) {
    await api(path, { method: "POST", body });
    setVersion((v) => v + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{kycCase.applicantName}</h1>
        <StatusBadge status={kycCase.status} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailPanel title="Applicant">
          <dl className="grid gap-3">
            {(Object.keys(PII_LABELS) as (keyof typeof PII_LABELS)[]).map((field) => (
              <MaskedField
                key={field}
                label={PII_LABELS[field]}
                maskedValue={kycCase[field]}
                canReveal={can(user, "pii.reveal")}
                minReasonLength={minRevealReasonLength}
                onReveal={async (reason) => {
                  const result = await api<{ field: string; value: string }>(`/api/kyc/cases/${id}/reveal`, { method: "POST", body: { field, reason } });
                  return result.value;
                }}
              />
            ))}
          </dl>
        </DetailPanel>

        <DetailPanel
          title="Risk"
          items={[
            { label: "Risk score", value: <span className={`text-lg ${riskTone(kycCase.riskScore)}`}>{kycCase.riskScore}</span> },
            { label: "Flags", value: kycCase.riskFlags.length ? kycCase.riskFlags.join(", ") : "—" },
            { label: "Assigned to", value: kycCase.assignedTo?.name ?? "Unassigned" },
            { label: "Created", value: formatDate(kycCase.createdAt) },
            { label: "Updated", value: formatDate(kycCase.updatedAt) },
            { label: "Case ID", value: <span className="font-mono text-xs">{kycCase.id}</span> },
          ]}
        />
      </div>

      {canAssign && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">Assign</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <select className="rounded border border-slate-300 px-2 py-1" value={analystId} onChange={(e) => setAnalystId(e.target.value)}>
              <option value="">Choose an analyst…</option>
              {analysts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.email})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!analystId}
              className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40"
              onClick={() => post(`/api/kyc/cases/${id}/assign`, { analystId }).catch((e: Error) => setError(e.message))}
            >
              Assign
            </button>
          </div>
        </section>
      )}

      {canStart && (
        <ApprovalBar title="Review" actions={[{ id: "start", label: "Start review", tone: "primary" }]} onAction={() => post(`/api/kyc/cases/${id}/start-review`)} />
      )}

      {canRecommend && (
        <ApprovalBar
          title="Recommendation"
          notePlaceholder="Why you recommend this outcome (required)"
          actions={[
            { id: "approve", label: "Recommend approve", tone: "primary", requiresNote: true },
            { id: "reject", label: "Recommend reject", tone: "danger", requiresNote: true },
          ]}
          onAction={(recommendation, note) => post(`/api/kyc/cases/${id}/recommend`, { recommendation, note })}
        />
      )}

      {pending && (
        <DetailPanel
          title="Pending approval"
          items={[
            { label: "Recommendation", value: pending.payload?.recommendation ?? "—" },
            { label: "Requested by", value: `${pending.requestedBy.name} · ${formatDate(pending.requestedAt)}` },
            { label: "Note", value: pending.requestNote },
          ]}
        />
      )}

      {canDecide && pending && (
        <ApprovalBar
          title="Decide"
          notePlaceholder="Decision note (required)"
          actions={[
            { id: "confirm", label: "Confirm recommendation", tone: "primary", requiresNote: true },
            { id: "return", label: "Return to analyst", tone: "danger", requiresNote: true },
          ]}
          onAction={(decision, note) => post(`/api/approvals/${pending.id}/decide`, { decision, note })}
        />
      )}

      <DetailPanel title="Audit trail">
        <AuditTrail events={kycCase.auditTrail} />
      </DetailPanel>
    </div>
  );
}
