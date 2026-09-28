import { formatDate } from "./client";

export type AuditTrailEvent = {
  id: string;
  timestamp: string | Date;
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
};

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  return <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

/** Chronological list of audit events; `before`/`after` arrive already PII-masked from the API. */
export function AuditTrail({ events, showEntity = false }: { events: AuditTrailEvent[]; showEntity?: boolean }) {
  if (events.length === 0) return <p className="text-sm text-slate-500">No audit events.</p>;
  return (
    <ol className="divide-y divide-slate-100">
      {events.map((event) => (
        <li key={event.id} className="py-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-mono text-xs text-slate-500">{formatDate(event.timestamp)}</span>
            <span className="font-medium">{event.action}</span>
            <span className="text-slate-600">
              by <span className="font-mono text-xs">{event.actorId}</span> ({event.actorRole})
            </span>
            {showEntity && (
              <span className="text-slate-600">
                on {event.entityType} <span className="font-mono text-xs">{event.entityId}</span>
              </span>
            )}
          </div>
          {event.reason && <p className="mt-1 text-slate-700">Reason: {event.reason}</p>}
          {(event.before !== null || event.after !== null) && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-slate-500">before / after</summary>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <Json value={event.before} />
                <Json value={event.after} />
              </div>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
