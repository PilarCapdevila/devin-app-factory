"use client";

import { useState } from "react";
import { ApiError } from "./client";

/**
 * Shows a masked PII value with a "Reveal" button that asks for a reason. The revealed value
 * lives only in this component's state and is never written back to the record on screen.
 */
export function MaskedField({
  label,
  maskedValue,
  canReveal,
  minReasonLength,
  onReveal,
}: {
  label: string;
  maskedValue: string;
  canReveal: boolean;
  /** Pass MIN_REVEAL_REASON_LENGTH from a server component (pii.ts is server-only). */
  minReasonLength: number;
  onReveal: (reason: string) => Promise<string>;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setRevealed(await onReveal(reason));
      setAsking(false);
      setReason("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Reveal failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-sm">
        <span className={revealed ? "font-mono" : "font-mono text-slate-500"}>{revealed ?? maskedValue}</span>
        {canReveal && revealed === null && !asking && (
          <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setAsking(true)}>
            Reveal
          </button>
        )}
        {revealed !== null && (
          <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => setRevealed(null)}>
            Hide
          </button>
        )}
      </dd>
      {asking && (
        <div className="mt-2 flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 p-2">
          <label className="text-xs text-slate-700">
            Reason for revealing (at least {minReasonLength} characters; this is audited)
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || reason.trim().length < minReasonLength}
              className="rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-40"
              onClick={submit}
            >
              Reveal value
            </button>
            <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
