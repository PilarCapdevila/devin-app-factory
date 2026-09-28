"use client";

import { useState } from "react";
import { api, ApiError } from "@/platform/ui/client";
import { CURRENCIES, type Currency } from "../types";
import { parseAmountToCents } from "./shared";

const EMPTY = { paymentId: "", customerName: "", customerEmail: "", cardLast4: "", amount: "", currency: "USD" as Currency, reason: "" };

/** Maker step: creates a refund in PENDING_APPROVAL and its approval request (POST /api/refunds). */
export function RefundRequestForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const amountCents = parseAmountToCents(form.amount);
    if (amountCents === null || amountCents <= 0) {
      setError("Enter a positive amount, e.g. 49.99");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/refunds", {
        method: "POST",
        body: {
          paymentId: form.paymentId.trim(),
          customerName: form.customerName.trim(),
          customerEmail: form.customerEmail.trim(),
          cardLast4: form.cardLast4.trim(),
          amountCents,
          currency: form.currency,
          reason: form.reason.trim(),
        },
      });
      setForm(EMPTY);
      setOpen(false);
      setMessage("Refund request submitted for approval.");
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">New refund request</h2>
        <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "New refund request"}
        </button>
      </div>
      {message && !open && <p className="mt-2 text-sm text-emerald-700">{message}</p>}
      {open && (
        <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-600">
            Payment ID
            <input className={input} required value={form.paymentId} onChange={(e) => set("paymentId", e.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Customer name
            <input className={input} required value={form.customerName} onChange={(e) => set("customerName", e.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Customer email
            <input className={input} type="email" required value={form.customerEmail} onChange={(e) => set("customerEmail", e.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Card last 4
            <input className={input} required inputMode="numeric" pattern="\d{4}" maxLength={4} value={form.cardLast4} onChange={(e) => set("cardLast4", e.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Amount
            <input className={input} required inputMode="decimal" placeholder="49.99" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </label>
          <label className="text-xs text-slate-600">
            Currency
            <select className={input} value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600 sm:col-span-2">
            Reason (shown to the approver)
            <textarea className={input} required rows={2} value={form.reason} onChange={(e) => set("reason", e.target.value)} />
          </label>
          {error && <p className="text-sm text-red-700 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-40">
              Submit for approval
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
