"use client";

import { useEffect, useState } from "react";
import { AuditTrail, type AuditTrailEvent } from "./AuditTrail";
import { api } from "./client";

const FILTERS = ["actorId", "action", "entityType", "entityId"] as const;
type Filters = Partial<Record<(typeof FILTERS)[number], string>>;

/** Platform page for admin and auditor: the full audit log with simple filters. */
export function AuditLog() {
  const [filters, setFilters] = useState<Filters>({});
  const [applied, setApplied] = useState<Filters>({});
  const [events, setEvents] = useState<AuditTrailEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    for (const key of FILTERS) {
      const value = applied[key]?.trim();
      if (value) query.set(key, value);
    }
    api<AuditTrailEvent[]>(`/api/audit${query.size ? `?${query}` : ""}`)
      .then((result) => {
        setError(null);
        setEvents(result);
      })
      .catch((e: Error) => {
        setEvents([]);
        setError(e.message);
      });
  }, [applied]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <form
        className="flex flex-wrap items-end gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ ...filters });
        }}
      >
        {FILTERS.map((key) => (
          <label key={key} className="flex flex-col text-xs text-slate-600">
            {key}
            <input
              className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
              value={filters[key] ?? ""}
              onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
            />
          </label>
        ))}
        <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          Filter
        </button>
      </form>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        {events === null ? <p className="text-sm text-slate-500">Loading…</p> : <AuditTrail events={events} showEntity />}
      </section>
    </div>
  );
}
