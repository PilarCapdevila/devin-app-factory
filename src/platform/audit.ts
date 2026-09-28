import type { Tx } from "./db";
import type { Role } from "./permissions";

export type AuditEventInput = {
  actorId: string;
  actorRole: Role;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

function toJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * Appends an AuditEvent using the caller's transaction, so the event and the change it
 * describes commit or roll back together. The timestamp is set by the database.
 */
export async function writeAuditEvent(tx: Tx, event: AuditEventInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: toJson(event.before),
      after: toJson(event.after),
      reason: event.reason ?? null,
    },
  });
}

export type AuditFilters = {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

/** Reads audit events, newest first, with `before`/`after` parsed back into objects. */
export async function listAuditEvents(tx: Tx, filters: AuditFilters = {}) {
  const events = await tx.auditEvent.findMany({
    where: {
      actorId: filters.actorId,
      action: filters.action,
      entityType: filters.entityType,
      entityId: filters.entityId,
      timestamp: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
    },
    orderBy: { timestamp: "desc" },
    take: filters.limit ?? 200,
  });
  return events.map((e) => ({
    ...e,
    before: e.before ? (JSON.parse(e.before) as unknown) : null,
    after: e.after ? (JSON.parse(e.after) as unknown) : null,
  }));
}
