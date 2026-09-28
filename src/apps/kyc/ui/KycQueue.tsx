"use client";

import { useEffect, useState } from "react";
import { api } from "@/platform/ui/client";
import { DataTable } from "@/platform/ui/DataTable";
import { CASE_STATUSES, type CaseStatus } from "../types";
import { StatusBadge } from "./StatusBadge";
import { riskTone, type CaseSummary } from "./shared";

const RISK_BANDS = [
  { label: "Any risk", min: undefined, max: undefined },
  { label: "High (75+)", min: 75, max: undefined },
  { label: "Medium (40–74)", min: 40, max: 74 },
  { label: "Low (<40)", min: undefined, max: 39 },
];

/** Cases visible to the current user (scoped by the API), highest risk first, PII masked. */
export function KycQueue() {
  const [status, setStatus] = useState<CaseStatus | "">("");
  const [band, setBand] = useState(0);
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    const { min, max } = RISK_BANDS[band];
    if (min !== undefined) query.set("minRisk", String(min));
    if (max !== undefined) query.set("maxRisk", String(max));
    api<CaseSummary[]>(`/api/kyc/cases${query.size ? `?${query}` : ""}`)
      .then(setCases)
      .catch((e: Error) => setError(e.message));
  }, [status, band]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">KYC Review Queue</h1>
        <div className="flex gap-2 text-sm">
          <select className="rounded border border-slate-300 px-2 py-1" value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | "")}>
            <option value="">All statuses</option>
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <select className="rounded border border-slate-300 px-2 py-1" value={band} onChange={(e) => setBand(Number(e.target.value))}>
            {RISK_BANDS.map((b, i) => (
              <option key={b.label} value={i}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {cases === null && !error ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <DataTable
          rows={cases ?? []}
          rowKey={(c) => c.id}
          rowHref={(c) => `/kyc/${c.id}`}
          emptyText="No cases match."
          columns={[
            { key: "applicant", header: "Applicant", render: (c) => c.applicantName },
            { key: "risk", header: "Risk", render: (c) => <span className={riskTone(c.riskScore)}>{c.riskScore}</span>, className: "w-16" },
            { key: "flags", header: "Flags", render: (c) => c.riskFlags.join(", ") || "—" },
            { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
            { key: "assigned", header: "Assigned to", render: (c) => c.assignedTo?.name ?? <span className="text-slate-400">Unassigned</span> },
            { key: "nationalId", header: "National ID", render: (c) => <span className="font-mono text-xs">{c.nationalId}</span> },
          ]}
        />
      )}
    </div>
  );
}
