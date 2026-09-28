"use client";

import { useState } from "react";
import { ApiError } from "./client";

export type ApprovalAction = {
  id: string;
  label: string;
  tone?: "primary" | "danger" | "neutral";
  requiresNote?: boolean;
};

const TONE: Record<NonNullable<ApprovalAction["tone"]>, string> = {
  primary: "bg-emerald-700 text-white hover:bg-emerald-800",
  danger: "bg-red-700 text-white hover:bg-red-800",
  neutral: "border border-slate-300 bg-white hover:bg-slate-100",
};

/**
 * Action bar showing only the actions the caller passes in (the server still decides what is
 * allowed). Actions that require a note share one note field.
 */
export function ApprovalBar({
  title,
  actions,
  onAction,
  notePlaceholder = "Note (required)",
}: {
  title: string;
  actions: ApprovalAction[];
  onAction: (actionId: string, note: string) => Promise<void>;
  notePlaceholder?: string;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsNote = actions.some((a) => a.requiresNote);

  if (actions.length === 0) return null;

  async function run(action: ApprovalAction) {
    setBusy(action.id);
    setError(null);
    try {
      await onAction(action.id, note.trim());
      setNote("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h2>
      {needsNote && (
        <textarea
          className="mb-3 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          rows={2}
          placeholder={notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={busy !== null || (action.requiresNote && note.trim().length === 0)}
            className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 ${TONE[action.tone ?? "neutral"]}`}
            onClick={() => run(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
