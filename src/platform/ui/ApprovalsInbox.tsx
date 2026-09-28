"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { entityHref } from "@/apps/links";
import { ApprovalBar } from "./ApprovalBar";
import { api, approvalProgressLabel, formatDate } from "./client";

type PendingRequest = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: unknown;
  requestNote: string;
  requestedAt: string;
  requestedBy: { id: string; name: string; email: string };
  requiredApprovals: number;
  confirmations: { id: string; confirmedAt: string; approver: { id: string; name: string; email: string } }[];
};

/** Platform page: pending requests across all apps that the current user may decide. */
export function ApprovalsInbox() {
  const [requests, setRequests] = useState<PendingRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<PendingRequest[]>("/api/approvals")
      .then(setRequests)
      .catch((e: Error) => setError(e.message));
  }, [version]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Approvals inbox</h1>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {requests === null && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {requests?.length === 0 && <p className="text-sm text-slate-500">Nothing waiting for your decision.</p>}
      {requests?.map((request) => {
        const href = entityHref(request.entityType, request.entityId);
        return (
          <div key={request.id} className="grid gap-3 md:grid-cols-[2fr_1fr]">
            <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{request.action}</span>
                <span className="font-mono text-xs text-slate-500">{formatDate(request.requestedAt)}</span>
              </div>
              <p className="mt-1 text-slate-700">
                {request.entityType}{" "}
                {href ? (
                  <Link href={href} className="font-mono text-xs text-blue-700 hover:underline">
                    {request.entityId}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{request.entityId}</span>
                )}
              </p>
              <p className="mt-1 text-slate-700">
                Requested by {request.requestedBy.name} ({request.requestedBy.email})
              </p>
              <p className="mt-1">
                <span className="text-slate-500">Payload:</span> <code className="text-xs">{JSON.stringify(request.payload)}</code>
              </p>
              <p className="mt-1">
                <span className="text-slate-500">Note:</span> {request.requestNote}
              </p>
              {approvalProgressLabel(request) && (
                <p className="mt-2 text-amber-800">
                  {approvalProgressLabel(request)}
                  {request.confirmations.length > 0 && <> · confirmed by {request.confirmations.map((c) => c.approver.name).join(", ")}</>}
                </p>
              )}
            </section>
            <ApprovalBar
              title="Decide"
              actions={[
                { id: "confirm", label: "Confirm", tone: "primary", requiresNote: true },
                { id: "return", label: "Return", tone: "danger", requiresNote: true },
              ]}
              onAction={async (decision, note) => {
                await api(`/api/approvals/${request.id}/decide`, { method: "POST", body: { decision, note } });
                setVersion((v) => v + 1);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
