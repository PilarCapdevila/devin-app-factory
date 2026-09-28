import { test, expect } from "@playwright/test";
import { writeAuditEvent } from "../../src/platform/audit";
import { auditCount, latestAuditEvent } from "./helpers/audit";
import { anyCaseAssignedTo, newCaseAssignedTo, startReview } from "./helpers/cases";
import { dbUser, prisma } from "./helpers/db";
import { dispose, login } from "./helpers/api";

test.describe("M9 Append-only audit (database triggers)", () => {
  test.beforeAll(async () => {
    // Guarantee at least one audit row exists before tampering attempts.
    const alice = await login("alice");
    const caseId = await newCaseAssignedTo("alice");
    expect((await startReview(alice, caseId)).status()).toBe(200);
    await dispose(alice);
    expect(await auditCount()).toBeGreaterThan(0);
  });

  test("M9: raw SQL UPDATE on AuditEvent is rejected and the row is unchanged", async () => {
    const target = await latestAuditEvent();
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET "reason" = ? WHERE "id" = ?`, "tampered", target.id),
    ).rejects.toThrow();
    const after = await prisma.auditEvent.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.reason).toBe(target.reason);
    expect(after.action).toBe(target.action);
  });

  test("M9: raw SQL UPDATE of actor and action columns is rejected", async () => {
    const target = await latestAuditEvent();
    const dan = await dbUser("dan");
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET "actorId" = ?, "action" = 'nothing.happened' WHERE "id" = ?`, dan.id, target.id),
    ).rejects.toThrow();
    const after = await prisma.auditEvent.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.actorId).toBe(target.actorId);
    expect(after.action).toBe(target.action);
  });

  test("M9: raw SQL DELETE of a single AuditEvent row is rejected", async () => {
    const target = await latestAuditEvent();
    const before = await auditCount();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "id" = ?`, target.id)).rejects.toThrow();
    expect(await auditCount()).toBe(before);
    expect(await prisma.auditEvent.findUnique({ where: { id: target.id } })).not.toBeNull();
  });

  test("M9: raw SQL DELETE without a WHERE clause is rejected", async () => {
    const before = await auditCount();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditEvent"`)).rejects.toThrow();
    expect(await auditCount()).toBe(before);
  });

  test("M9: raw SQL bulk UPDATE without a WHERE clause is rejected", async () => {
    const before = await prisma.auditEvent.findMany({ select: { id: true, reason: true } });
    await expect(prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET "reason" = 'bulk tamper'`)).rejects.toThrow();
    const after = await prisma.auditEvent.findMany({ select: { id: true, reason: true } });
    expect(after).toEqual(before);
  });

  test("M9: Prisma update / updateMany on AuditEvent are rejected", async () => {
    const target = await latestAuditEvent();
    await expect(prisma.auditEvent.update({ where: { id: target.id }, data: { reason: "tampered via prisma" } })).rejects.toThrow();
    await expect(prisma.auditEvent.updateMany({ data: { reason: "tampered via prisma" } })).rejects.toThrow();
    const after = await prisma.auditEvent.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.reason).toBe(target.reason);
  });

  test("M9: Prisma delete / deleteMany on AuditEvent are rejected", async () => {
    const target = await latestAuditEvent();
    const before = await auditCount();
    await expect(prisma.auditEvent.delete({ where: { id: target.id } })).rejects.toThrow();
    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow();
    expect(await auditCount()).toBe(before);
  });

  test("M9: tampering inside a transaction is rejected and does not affect other writes", async () => {
    const target = await latestAuditEvent();
    const before = await auditCount();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "id" = ?`, target.id);
      }),
    ).rejects.toThrow();
    expect(await auditCount()).toBe(before);
  });

  test("M9: inserting audit events is still allowed (append is the only permitted operation)", async () => {
    const alice = await dbUser("alice");
    const caseId = await anyCaseAssignedTo("alice");
    const before = await auditCount();
    await prisma.$transaction(async (tx) => {
      await writeAuditEvent(tx, {
        actorId: alice.id,
        actorRole: alice.role,
        action: "security.suite.append",
        entityType: "KycCase",
        entityId: caseId,
        before: { probe: "before" },
        after: { probe: "after" },
        reason: "append-only trigger check",
      });
    });
    expect(await auditCount()).toBe(before + 1);
  });
});
