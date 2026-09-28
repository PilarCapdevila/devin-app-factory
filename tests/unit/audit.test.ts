import { describe, expect, it } from "vitest";
import { listAuditEvents, writeAuditEvent } from "@/platform/audit";
import { prisma, withTransaction } from "@/platform/db";
import { dan, erin } from "./helpers";

describe("audit log", () => {
  it("writes an event inside the caller's transaction and rolls back with it", async () => {
    const entityId = `rollback-${Date.now()}`;
    const admin = await dan();
    await expect(
      withTransaction(async (tx) => {
        await writeAuditEvent(tx, { actorId: admin.id, actorRole: admin.role, action: "test.event", entityType: "test", entityId, after: { ok: true } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await prisma.auditEvent.count({ where: { entityId } })).toBe(0);
  });

  it("lists events newest first with parsed before/after and filters", async () => {
    const entityId = `list-${Date.now()}`;
    const admin = await dan();
    const auditor = await erin();
    await writeAuditEvent(prisma, { actorId: admin.id, actorRole: admin.role, action: "test.first", entityType: "test", entityId, before: { a: 1 } });
    await writeAuditEvent(prisma, { actorId: auditor.id, actorRole: auditor.role, action: "test.second", entityType: "test", entityId, after: { b: 2 } });
    const events = await listAuditEvents(prisma, { entityType: "test", entityId });
    expect(events.map((e) => e.action)).toEqual(["test.second", "test.first"]);
    expect(events[0].after).toEqual({ b: 2 });
    expect(events[1].before).toEqual({ a: 1 });
    expect(await listAuditEvents(prisma, { entityId, actorId: auditor.id })).toHaveLength(1);
  });

  it("is append-only: UPDATE and DELETE are rejected by database triggers (SECURITY.md M9)", async () => {
    const entityId = `append-only-${Date.now()}`;
    const admin = await dan();
    await writeAuditEvent(prisma, { actorId: admin.id, actorRole: admin.role, action: "test.locked", entityType: "test", entityId });
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId } });

    // Prisma reports SQLITE_CONSTRAINT_TRIGGER as a generic constraint error; raw SQL keeps the trigger message.
    await expect(prisma.auditEvent.update({ where: { id: event.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET action = 'tampered' WHERE id = '${event.id}'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = '${event.id}'`)).rejects.toThrow(/append-only/);

    const unchanged = await prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(unchanged.action).toBe("test.locked");
  });
});
