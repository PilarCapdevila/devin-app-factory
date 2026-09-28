"use client";

import { useEffect, useState } from "react";
import type { SessionUser } from "@/platform/auth";
import { can } from "@/platform/permissions";
import { ApprovalBar } from "@/platform/ui/ApprovalBar";
import { AuditTrail, type AuditTrailEvent } from "@/platform/ui/AuditTrail";
import { api, formatDate } from "@/platform/ui/client";
import { DetailPanel } from "@/platform/ui/DetailPanel";
import { MaskedField } from "@/platform/ui/MaskedField";
import { DISPUTE_PII_FIELDS, type DisputePiiField, type Proposal } from "../types";
import { DueBadge } from "./DueBadge";
import { StatusBadge } from "./StatusBadge";
import { PROPOSAL_LABELS, formatAmount, formatReason, timeRemaining, type DisputeSummary } from "./shared";

type ApprovalRequestView = {
  id: string;
  status: "PENDING" | "CONFIRMED" | "RETURNED";
  payload: { proposal?: Proposal; evidenceSummary?: string | null } | null;
  requestNote: string;
  requestedAt: string;
  requestedById: string;
  requestedBy: { name: string };
  decidedBy: { name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

type DisputeView = DisputeSummary & { auditTrail: AuditTrailEvent[]; approvalRequests: ApprovalRequestView[] };
type Analyst = { id: string; name: string; email: string };

const PII_LABELS: Record<DisputePiiField, string> = { cardholderName: "Cardholder name", customerEmail: "Customer email" };

export function DisputeDetail({ id, user, minRevealReasonLength }: { id: string; user: SessionUser; minRevealReasonLength: number }) {
  const [dispute, setDispute] = useState<DisputeView | null>(null);
  const [analysts, setAnalysts] = useState<Analyst[]>([]);
  const [analystId, setAnalystId] = useState("");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const canAssignRole = can(user, "disputes.dispute.assign");

  useEffect(() => {
    api<DisputeView>(`/api/disputes/${id}`)
      .then(setDispute)
      .catch((e: Error) => setError(e.message));
  }, [id, version]);

  useEffect(() => {
    if (canAssignRole) api<Analyst[]>("/api/disputes/analysts").then(setAnalysts).catch(() => setAnalysts([]));
  }, [canAssignRole]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!dispute) return <p className="text-sm text-slate-500">Loading…</p>;

  const pending = dispute.approvalRequests.find((r) => r.status === "PENDING");
  const canAssign = canAssignRole && (dispute.status === "NEW" || dispute.status === "IN_REVIEW");
  const canStart = can(user, "disputes.dispute.work") && dispute.status === "NEW";
  const canPropose = can(user, "disputes.dispute.work") && dispute.status === "IN_REVIEW";
  const canDecide = can(user, "disputes.dispute.decide") && pending !== undefined && pending.requestedById !== user.id;
  const pendingProposal = pending?.payload?.proposal;

  async function post(path: string, body?: unknown) {
    await api(path, { method: "POST", body });
    setVersion((v) => v + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Dispute <span className="font-mono">{dispute.caseReference}</span>
        </h1>
        <div className="flex items-center gap-2">
          <DueBadge dueState={dispute.dueState} />
          <StatusBadge status={dispute.status} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailPanel
          title="Payment"
          items={[
            { label: "Payment reference", value: <span className="font-mono text-xs">{dispute.paymentReference}</span> },
            { label: "Amount", value: <span className="text-lg font-semibold">{formatAmount(dispute.amountCents, dispute.currency)}</span> },
            { label: "Payment date", value: formatDate(dispute.paymentDate) },
            { label: "Card", value: <span className="font-mono">•••• •••• •••• {dispute.cardLast4}</span> },
            { label: "Reason code", value: formatReason(dispute.reasonCode) },
            { label: "Customer statement", value: dispute.customerStatement },
          ]}
        />

        <div className="flex flex-col gap-4">
          <DetailPanel title="Customer">
            <dl className="grid gap-3">
              {DISPUTE_PII_FIELDS.map((field) => (
                <MaskedField
                  key={field}
                  label={PII_LABELS[field]}
                  maskedValue={dispute[field]}
                  canReveal={can(user, "pii.reveal")}
                  minReasonLength={minRevealReasonLength}
                  onReveal={async (reason) => {
                    const result = await api<{ field: string; value: string }>(`/api/disputes/${id}/reveal`, { method: "POST", body: { field, reason } });
                    return result.value;
                  }}
                />
              ))}
            </dl>
          </DetailPanel>

          <DetailPanel
            title="Deadline"
            items={[
              {
                label: "Respond by",
                value: (
                  <span className="flex items-center gap-2">
                    {formatDate(dispute.respondBy)}
                    <DueBadge dueState={dispute.dueState} />
                    {dispute.dueState !== "closed" && <span className="text-xs text-slate-500">{timeRemaining(dispute.respondBy)}</span>}
                  </span>
                ),
              },
              { label: "Assigned to", value: dispute.assignedTo?.name ?? "Unassigned" },
              { label: "Proposal", value: dispute.proposal ? PROPOSAL_LABELS[dispute.proposal] : "—" },
              { label: "Evidence summary", value: dispute.evidenceSummary ?? "—" },
              { label: "Created", value: formatDate(dispute.createdAt) },
              { label: "Updated", value: formatDate(dispute.updatedAt) },
              { label: "Dispute ID", value: <span className="font-mono text-xs">{dispute.id}</span> },
            ]}
          />
        </div>
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
              onClick={() => post(`/api/disputes/${id}/assign`, { analystId }).catch((e: Error) => setError(e.message))}
            >
              Assign
            </button>
          </div>
        </section>
      )}

      {canStart && (
        <ApprovalBar title="Review" actions={[{ id: "start", label: "Start review", tone: "primary" }]} onAction={() => post(`/api/disputes/${id}/start-review`)} />
      )}

      {canPropose && (
        <div className="flex flex-col gap-2">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-600">Evidence summary</h2>
            <p className="mb-2 text-xs text-slate-500">Required to fight the dispute (at least 20 characters); optional when accepting.</p>
            <textarea
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              rows={3}
              placeholder="What evidence we hold: delivery confirmation, device/IP match, prior undisputed payments…"
              value={evidenceSummary}
              onChange={(e) => setEvidenceSummary(e.target.value)}
            />
          </section>
          <ApprovalBar
            title="Proposal"
            notePlaceholder="Why you propose this outcome (required)"
            actions={[
              { id: "accept", label: "Propose accept", tone: "danger", requiresNote: true },
              { id: "fight", label: "Propose fight", tone: "primary", requiresNote: true },
            ]}
            onAction={(proposal, note) =>
              post(`/api/disputes/${id}/propose`, {
                proposal,
                note,
                ...(evidenceSummary.trim() ? { evidenceSummary: evidenceSummary.trim() } : {}),
              })
            }
          />
        </div>
      )}

      {pending && (
        <DetailPanel
          title="Pending approval"
          items={[
            { label: "Proposal", value: pendingProposal ? PROPOSAL_LABELS[pendingProposal] : "—" },
            { label: "Evidence summary", value: pending.payload?.evidenceSummary ?? "—" },
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
            { id: "confirm", label: pendingProposal === "fight" ? "Confirm: fight dispute" : "Confirm: accept dispute", tone: "primary", requiresNote: true },
            { id: "return", label: "Return to analyst", tone: "danger", requiresNote: true },
          ]}
          onAction={(decision, note) => post(`/api/approvals/${pending.id}/decide`, { decision, note })}
        />
      )}

      <DetailPanel title="Audit trail">
        <AuditTrail events={dispute.auditTrail} />
      </DetailPanel>
    </div>
  );
}
