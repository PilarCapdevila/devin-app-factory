"use client";

import { useEffect, useState } from "react";
import { api, formatDate } from "@/platform/ui/client";
import { DataTable } from "@/platform/ui/DataTable";
import { DISPUTE_STATUSES, type DisputeStatus } from "../types";
import { StatusBadge } from "./StatusBadge";
import { deadlineLabel, deadlineTone, formatAmount, type DisputeSummary } from "./shared";

const DEADLINE_FILTERS = [
  { label: "Any deadline", dueWithinDays: undefined },
  { label: "Overdue", dueWithinDays: 0 },
  { label: "Due in ≤3 days", dueWithinDays: 3 },
  { label: "Due in ≤7 days", dueWithinDays: 7 },
];

/** Disputes visible to the current user (scoped by the API), nearest deadline first, PII masked. */
export function DisputeQueue() {
  const [status, setStatus] = useState<DisputeStatus | "">("");
  const [deadlineFilter, setDeadlineFilter] = useState(0);
  const [disputes, setDisputes] = useState<DisputeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    const { dueWithinDays } = DEADLINE_FILTERS[deadlineFilter];
    if (dueWithinDays !== undefined) query.set("dueWithinDays", String(dueWithinDays));
    api<DisputeSummary[]>(`/api/disputes${query.size ? `?${query}` : ""}`)
      .then(setDisputes)
      .catch((e: Error) => setError(e.message));
  }, [status, deadlineFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Disputes</h1>
        <div className="flex gap-2 text-sm">
          <select className="rounded border border-slate-300 px-2 py-1" value={status} onChange={(e) => setStatus(e.target.value as DisputeStatus | "")}>
            <option value="">All statuses</option>
            {DISPUTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <select className="rounded border border-slate-300 px-2 py-1" value={deadlineFilter} onChange={(e) => setDeadlineFilter(Number(e.target.value))}>
            {DEADLINE_FILTERS.map((f, i) => (
              <option key={f.label} value={i}>
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
            { key: "merchant", header: "Merchant", render: (d) => d.merchantName },
            { key: "amount", header: "Amount", render: (d) => formatAmount(d.amountMinor, d.currency), className: "w-28" },
            { key: "reason", header: "Reason", render: (d) => d.reasonCode },
            { key: "customer", header: "Customer", render: (d) => d.customerName },
            { key: "card", header: "Card", render: (d) => <span className="font-mono text-xs">•••• {d.cardLast4}</span>, className: "w-20" },
            {
              key: "deadline",
              header: "Respond by",
              render: (d) => (
                <span className={deadlineTone(d.responseDeadline, d.status)}>
                  {formatDate(d.responseDeadline)} <span className="text-xs">({deadlineLabel(d.responseDeadline)})</span>
                </span>
              ),
            },
            { key: "status", header: "Status", render: (d) => <StatusBadge status={d.status} /> },
            { key: "assigned", header: "Assigned to", render: (d) => d.assignedTo?.name ?? <span className="text-slate-400">Unassigned</span> },
          ]}
        />
      )}
    </div>
  );
}
