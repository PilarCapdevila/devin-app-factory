"use client";

import { useEffect, useState } from "react";
import type { SessionUser } from "@/platform/auth";
import { can } from "@/platform/permissions";
import { ApprovalBar } from "@/platform/ui/ApprovalBar";
import { AuditTrail, type AuditTrailEvent } from "@/platform/ui/AuditTrail";
import { api, approvalProgressLabel, formatDate } from "@/platform/ui/client";
import { DetailPanel } from "@/platform/ui/DetailPanel";
import { MaskedField } from "@/platform/ui/MaskedField";
import { StatusBadge } from "./StatusBadge";
import { formatMoney, type RefundSummary } from "./shared";

type ApprovalRequestView = {
  id: string;
  status: "PENDING" | "CONFIRMED" | "RETURNED";
  payload: { paymentId?: string; amountCents?: number; currency?: string } | null;
  requestNote: string;
  requestedAt: string;
  requestedById: string;
  requestedBy: { name: string };
  decidedBy: { name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  requiredApprovals: number;
  confirmations: { id: string; confirmedAt: string; note: string; approver: { id: string; name: string } }[];
};

function confirmedByLabel(confirmations: ApprovalRequestView["confirmations"]): string {
  if (confirmations.length === 0) return "Nobody yet";
  return confirmations.map((c) => `${c.approver.name} · ${formatDate(c.confirmedAt)}`).join("; ");
}

type RefundView = RefundSummary & { auditTrail: AuditTrailEvent[]; approvalRequests: ApprovalRequestView[] };

export function RefundDetail({ id, user, minRevealReasonLength }: { id: string; user: SessionUser; minRevealReasonLength: number }) {
  const [refund, setRefund] = useState<RefundView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<RefundView>(`/api/refunds/${id}`)
      .then(setRefund)
      .catch((e: Error) => setError(e.message));
  }, [id, version]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!refund) return <p className="text-sm text-slate-500">Loading…</p>;

  const pending = refund.approvalRequests.find((r) => r.status === "PENDING");
  const alreadyConfirmed = pending?.confirmations.some((c) => c.approver.id === user.id) ?? false;
  const canDecide = can(user, "refunds.refund.decide") && pending !== undefined && pending.requestedById !== user.id && !alreadyConfirmed;
  const decided = refund.approvalRequests.find((r) => r.status !== "PENDING");

  async function decide(decision: string, note: string) {
    if (!pending) return;
    await api(`/api/approvals/${pending.id}/decide`, { method: "POST", body: { decision, note } });
    setVersion((v) => v + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Refund {formatMoney(refund.amountCents, refund.currency)} · <span className="font-mono text-base">{refund.paymentId}</span>
        </h1>
        <StatusBadge status={refund.status} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailPanel title="Customer">
          <dl className="grid gap-3">
            <div>
              <dt className="text-xs text-slate-500">Name</dt>
              <dd className="text-sm">{refund.customerName}</dd>
            </div>
            <MaskedField
              label="Email"
              maskedValue={refund.customerEmail}
              canReveal={can(user, "pii.reveal")}
              minReasonLength={minRevealReasonLength}
              onReveal={async (reason) => {
                const result = await api<{ field: string; value: string }>(`/api/refunds/${id}/reveal`, { method: "POST", body: { field: "customerEmail", reason } });
                return result.value;
              }}
            />
            <div>
              <dt className="text-xs text-slate-500">Card</dt>
              <dd className="font-mono text-sm">•••• {refund.cardLast4}</dd>
            </div>
          </dl>
        </DetailPanel>

        <DetailPanel
          title="Refund"
          items={[
            { label: "Amount", value: <span className="text-lg font-semibold">{formatMoney(refund.amountCents, refund.currency)}</span> },
            { label: "Payment ID", value: <span className="font-mono text-xs">{refund.paymentId}</span> },
            { label: "Reason", value: refund.reason },
            { label: "Requested by", value: `${refund.requestedBy.name} · ${formatDate(refund.createdAt)}` },
            { label: "Issued", value: refund.issuedAt ? formatDate(refund.issuedAt) : "—" },
            { label: "Refund ID", value: <span className="font-mono text-xs">{refund.id}</span> },
          ]}
        />
      </div>

      {pending && (
        <DetailPanel
          title="Pending approval"
          items={[
            { label: "Will issue", value: pending.payload?.amountCents !== undefined ? formatMoney(pending.payload.amountCents, pending.payload.currency) : "—" },
            { label: "Requested by", value: `${pending.requestedBy.name} · ${formatDate(pending.requestedAt)}` },
            { label: "Note", value: pending.requestNote },
            ...(pending.requiredApprovals > 1
              ? [
                  { label: "Approval progress", value: <span className="font-medium text-amber-800">{approvalProgressLabel(pending)}</span> },
                  { label: "Confirmed by", value: confirmedByLabel(pending.confirmations) },
                ]
              : []),
          ]}
        />
      )}

      {pending && alreadyConfirmed && (
        <p className="text-sm text-slate-600">You have confirmed this refund; it is waiting for another approver.</p>
      )}

      {canDecide && pending && (
        <ApprovalBar
          title="Decide"
          notePlaceholder="Decision note (required)"
          actions={[
            {
              id: "confirm",
              label: pending.requiredApprovals > pending.confirmations.length + 1 ? "Confirm (more approvals needed)" : "Confirm and issue refund",
              tone: "primary",
              requiresNote: true,
            },
            { id: "return", label: "Return to support", tone: "danger", requiresNote: true },
          ]}
          onAction={decide}
        />
      )}

      {!pending && decided && (
        <DetailPanel
          title="Decision"
          items={[
            { label: "Outcome", value: decided.status === "CONFIRMED" ? "Confirmed — refund issued" : "Returned — no refund issued" },
            { label: "Decided by", value: `${decided.decidedBy?.name ?? "—"} · ${formatDate(decided.decidedAt)}` },
            { label: "Note", value: decided.decisionNote ?? "—" },
            ...(decided.requiredApprovals > 1
              ? [
                  { label: "Approvals", value: `${decided.confirmations.length} of ${decided.requiredApprovals}` },
                  { label: "Confirmed by", value: confirmedByLabel(decided.confirmations) },
                ]
              : []),
          ]}
        />
      )}

      <DetailPanel title="Audit trail">
        <AuditTrail events={refund.auditTrail} />
      </DetailPanel>
    </div>
  );
}
