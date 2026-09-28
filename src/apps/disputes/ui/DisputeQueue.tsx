"use client";

import { useEffect, useState } from "react";
import { api, formatDate } from "@/platform/ui/client";
import { DataTable } from "@/platform/ui/DataTable";
import { DISPUTE_STATUSES, DUE_SOON_HOURS, type DisputeStatus } from "../types";
import { DueBadge } from "./DueBadge";
import { StatusBadge } from "./StatusBadge";
import { formatAmount, formatReason, timeRemaining, type DisputeSummary } from "./shared";

const DUE_FILTERS = [
  { value: "", label: "Any deadline" },
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: `Due within ${DUE_SOON_HOURS} h` },
  { value: "on_track", label: "On track" },
] as const;
type DueFilter = (typeof DUE_FILTERS)[number]["value"];

/** Disputes visible to the current user (scoped by the API), soonest deadline first, PII masked. */
export function DisputeQueue() {
  const [status, setStatus] = useState<DisputeStatus | "">("");
  const [due, setDue] = useState<DueFilter>("");
  const [disputes, setDisputes] = useState<DisputeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (due) query.set("due", due);
    api<DisputeSummary[]>(`/api/disputes${query.size ? `?${query}` : ""}`)
      .then(setDisputes)
      .catch((e: Error) => setError(e.message));
  }, [status, due]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Dispute Queue</h1>
        <div className="flex gap-2 text-sm">
          <select className="rounded border border-slate-300 px-2 py-1" value={status} onChange={(e) => setStatus(e.target.value as DisputeStatus | "")}>
            <option value="">All statuses</option>
            {DISPUTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <select className="rounded border border-slate-300 px-2 py-1" value={due} onChange={(e) => setDue(e.target.value as DueFilter)}>
            {DUE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {disputes === null && !error ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <DataTable
          rows={disputes ?? []}
          rowKey={(d) => d.id}
          rowHref={(d) => `/disputes/${d.id}`}
          emptyText="No disputes match."
          columns={[
            { key: "reference", header: "Dispute", render: (d) => <span className="font-mono text-xs">{d.caseReference}</span> },
            { key: "payment", header: "Payment", render: (d) => <span className="font-mono text-xs">{d.paymentReference}</span> },
            { key: "amount", header: "Amount", render: (d) => formatAmount(d.amountCents, d.currency), className: "whitespace-nowrap" },
            { key: "reason", header: "Reason", render: (d) => formatReason(d.reasonCode) },
            {
              key: "respondBy",
              header: "Respond by",
              render: (d) => (
                <span className="flex flex-col gap-1">
                  <span className="whitespace-nowrap">{formatDate(d.respondBy)}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    <DueBadge dueState={d.dueState} />
                    {d.dueState !== "closed" && timeRemaining(d.respondBy)}
                  </span>
                </span>
              ),
            },
            { key: "status", header: "Status", render: (d) => <StatusBadge status={d.status} /> },
            { key: "assigned", header: "Assigned to", render: (d) => d.assignedTo?.name ?? <span className="text-slate-400">Unassigned</span> },
            { key: "card", header: "Card", render: (d) => <span className="font-mono text-xs">•••• {d.cardLast4}</span> },
          ]}
        />
      )}
    </div>
  );
}
