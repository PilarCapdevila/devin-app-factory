import { expect } from "@playwright/test";
import { prisma } from "./db";

/** Shape of an AuditEvent row as fixed by SPEC.md §9. */
export interface AuditRow {
  id: string;
  timestamp: Date;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
}

const auditSelect = {
  id: true,
  timestamp: true,
  actorId: true,
  actorRole: true,
  action: true,
  entityType: true,
  entityId: true,
  before: true,
  after: true,
  reason: true,
} as const;

export interface AuditFilter {
  since?: Date;
  actorId?: string;
  entityId?: string;
  /** Substring or regex matched against `action`. */
  action?: string | RegExp;
}

export async function auditEvents(filter: AuditFilter = {}): Promise<AuditRow[]> {
  const rows = await prisma.auditEvent.findMany({
    where: {
      ...(filter.since ? { timestamp: { gte: filter.since } } : {}),
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
    },
    orderBy: { timestamp: "asc" },
    select: auditSelect,
  });
  if (filter.action === undefined) return rows;
  const matcher = filter.action;
  return rows.filter((row) =>
    typeof matcher === "string" ? row.action.includes(matcher) : matcher.test(row.action),
  );
}

export async function auditCount(): Promise<number> {
  return prisma.auditEvent.count();
}

export async function latestAuditEvent(): Promise<AuditRow> {
  return prisma.auditEvent.findFirstOrThrow({ orderBy: { timestamp: "desc" }, select: auditSelect });
}

/** The most recent event of a non-empty list, failing with `what` when nothing was written. */
export function lastEvent(events: AuditRow[], what: string): AuditRow {
  const event = events.at(-1);
  expect(event, `${what}: expected at least one audit event`).toBeDefined();
  if (!event) throw new Error(`${what}: no audit event`);
  return event;
}

/** Asserts that every field M8 requires is present on a state-change event. */
export function expectCompleteEvent(
  event: AuditRow,
  expected: { actorId: string; actorRole: string; entityId: string; entityType?: string },
): void {
  expect(event.actorId).toBe(expected.actorId);
  expect(event.actorRole).toBe(expected.actorRole);
  expect(event.action).toBeTruthy();
  expect(event.entityType).toBeTruthy();
  if (expected.entityType) expect(event.entityType).toBe(expected.entityType);
  expect(event.entityId).toBe(expected.entityId);
  expect(event.timestamp).toBeInstanceOf(Date);
  expect(event.timestamp.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  expect(event.before, "before state").not.toBeUndefined();
  expect(event.after, "after state").not.toBeUndefined();
}

/** Renders `before`/`after` JSON columns as text regardless of whether Prisma returns them parsed or as strings. */
export function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}
