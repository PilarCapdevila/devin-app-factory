"use client";

import { useEffect, useState } from "react";
import type { SessionUser } from "@/platform/auth";
import { can } from "@/platform/permissions";
import { api, formatDate } from "@/platform/ui/client";
import { DataTable } from "@/platform/ui/DataTable";
import { REFUND_STATUSES, type RefundStatus } from "../types";
import { RefundRequestForm } from "./RefundRequestForm";
import { StatusBadge } from "./StatusBadge";
import { formatMoney, parseAmountToCents, type RefundSummary, type RefundTotals } from "./shared";

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/** Refunds visible to the current user (scoped by the API), newest first, customer email masked. */
export function RefundsDashboard({ user }: { user: SessionUser }) {
  const [status, setStatus] = useState<RefundStatus | "">("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [applied, setApplied] = useState({ status: "" as RefundStatus | "", min: "", max: "" });
  const [refunds, setRefunds] = useState<RefundSummary[] | null>(null);
  const [totals, setTotals] = useState<RefundTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const canRequest = can(user, "refunds.refund.request");

  useEffect(() => {
    const query = new URLSearchParams();
    if (applied.status) query.set("status", applied.status);
    const min = parseAmountToCents(applied.min);
    const max = parseAmountToCents(applied.max);
    if (min !== null) query.set("minAmountCents", String(min));
    if (max !== null) query.set("maxAmountCents", String(max));
    api<RefundSummary[]>(`/api/refunds${query.size ? `?${query}` : ""}`)
      .then((rows) => {
        setError(null);
        setRefunds(rows);
      })
      .catch((e: Error) => setError(e.message));
  }, [applied, version]);

  useEffect(() => {
    api<RefundTotals>("/api/refunds/summary")
      .then(setTotals)
      .catch((e: Error) => setError(e.message));
  }, [version]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Refunds Dashboard</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Pending approval" value={totals ? String(totals.pending.count) : "…"} hint="requests waiting for a decision" />
        <Tile label="Pending total" value={totals ? formatMoney(totals.pending.totalCents) : "…"} hint="amount awaiting approval" />
        <Tile label="Issued today" value={totals ? String(totals.issuedToday.count) : "…"} hint="refunds issued since 00:00 UTC" />
        <Tile label="Issued today total" value={totals ? formatMoney(totals.issuedToday.totalCents) : "…"} hint="amount issued since 00:00 UTC" />
      </div>

      {canRequest && <RefundRequestForm onCreated={() => setVersion((v) => v + 1)} />}

      <form
        className="flex flex-wrap items-end gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ status, min: minAmount, max: maxAmount });
        }}
      >
        <label className="flex flex-col text-xs text-slate-600">
          Status
          <select className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value as RefundStatus | "")}>
            <option value="">All statuses</option>
            {REFUND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          Min amount ($)
          <input className="mt-1 w-28 rounded border border-slate-300 px-2 py-1 text-sm" inputMode="decimal" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          Max amount ($)
          <input className="mt-1 w-28 rounded border border-slate-300 px-2 py-1 text-sm" inputMode="decimal" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
        </label>
        <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-white">
          Apply filters
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-3 py-1.5"
          onClick={() => {
            setStatus("");
            setMinAmount("");
            setMaxAmount("");
            setApplied({ status: "", min: "", max: "" });
          }}
        >
          Clear
        </button>
      </form>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {refunds === null && !error ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <DataTable
          rows={refunds ?? []}
          rowKey={(r) => r.id}
          rowHref={(r) => `/refunds/${r.id}`}
          emptyText="No refunds match."
          columns={[
            { key: "payment", header: "Payment", render: (r) => <span className="font-mono text-xs">{r.paymentId}</span> },
            { key: "customer", header: "Customer", render: (r) => r.customerName },
            { key: "email", header: "Email", render: (r) => <span className="font-mono text-xs text-slate-500">{r.customerEmail}</span> },
            { key: "card", header: "Card", render: (r) => <span className="font-mono text-xs">•••• {r.cardLast4}</span>, className: "w-24" },
            { key: "amount", header: "Amount", render: (r) => formatMoney(r.amountCents, r.currency), className: "text-right" },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "requested", header: "Requested", render: (r) => `${r.requestedBy.name} · ${formatDate(r.createdAt)}` },
          ]}
        />
      )}
    </div>
  );
}
