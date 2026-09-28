import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/platform/auth";

const currentUser = vi.hoisted(() => ({ value: null as SessionUser | null }));
vi.mock("@/platform/auth", () => ({ getCurrentUser: async () => currentUser.value }));

import { prisma } from "@/platform/db";
import { ForbiddenError, NotFoundError, secureHandler } from "@/platform/handler";
import type { Permission } from "@/platform/permissions";
import { alice, dan, jsonRequest } from "./helpers";

const ctx = { params: Promise.resolve({ id: "abc" }) };
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

describe("secureHandler", () => {
  beforeEach(() => {
    errorSpy.mockClear();
  });

  it("returns 401 without a session", async () => {
    currentUser.value = null;
    const handler = secureHandler({ permission: "kyc.case.read" }, async () => ({ ok: true }));
    const response = await handler(jsonRequest("GET", "/api/x"), ctx);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("fails closed when no permission is declared, even for a logged-in user", async () => {
    currentUser.value = await dan();
    const handler = secureHandler({ permission: undefined as unknown as Permission }, async () => ({ ok: true }));
    const response = await handler(jsonRequest("GET", "/api/no-permission"), ctx);
    expect(response.status).toBe(403);
    const denied = await prisma.auditEvent.findFirst({ where: { action: "access.denied", entityId: "GET /api/no-permission" } });
    expect(denied?.actorId).toBe(currentUser.value.id);
  });

  it("returns 403 and audits when the user lacks the permission", async () => {
    currentUser.value = await alice();
    const handler = secureHandler({ permission: "audit.read" }, async () => ({ ok: true }));
    const response = await handler(jsonRequest("GET", "/api/audit-test"), ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    const denied = await prisma.auditEvent.findFirst({ where: { action: "access.denied", entityId: "GET /api/audit-test" } });
    expect(denied?.reason).toContain("audit.read");
  });

  it("accepts any-of permission lists", async () => {
    currentUser.value = await alice();
    const handler = secureHandler({ permission: ["audit.read", "kyc.case.read"] }, async () => ({ ok: true }));
    expect((await handler(jsonRequest("GET", "/api/any"), ctx)).status).toBe(200);
  });

  it("validates input strictly and returns a generic 400", async () => {
    currentUser.value = await alice();
    const handler = secureHandler({ permission: "kyc.case.read", input: z.strictObject({ note: z.string().min(1) }) }, async ({ input }) => input);
    expect((await handler(jsonRequest("POST", "/api/v", { note: "x", extra: 1 }), ctx)).status).toBe(400);
    expect((await handler(jsonRequest("POST", "/api/v", { note: "" }), ctx)).status).toBe(400);
    const bad = await handler(new Request("http://localhost/api/v", { method: "POST", body: "{not json" }), ctx);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Invalid input" });
    const ok = await handler(jsonRequest("POST", "/api/v", { note: "fine" }), ctx);
    expect(await ok.json()).toEqual({ note: "fine" });
  });

  it("parses GET query strings through the schema", async () => {
    currentUser.value = await alice();
    const handler = secureHandler({ permission: "kyc.case.read", input: z.strictObject({ status: z.enum(["NEW"]).optional() }) }, async ({ input }) => input);
    expect((await handler(jsonRequest("GET", "/api/q?status=NEW"), ctx)).status).toBe(200);
    expect((await handler(jsonRequest("GET", "/api/q?status=BAD"), ctx)).status).toBe(400);
  });

  it("masks PII in responses by default and passes params", async () => {
    currentUser.value = await alice();
    const handler = secureHandler({ permission: "kyc.case.read" }, async ({ params }) => ({
      id: params.id,
      nationalId: "TEST-99991234",
      nested: [{ address: "secret", dateOfBirth: "1990-01-01" }],
    }));
    const body = await (await handler(jsonRequest("GET", "/api/m"), ctx)).json();
    expect(body).toEqual({ id: "abc", nationalId: "••••••1234", nested: [{ address: "••••••", dateOfBirth: "••••••" }] });
  });

  it("revealsPii skips masking only when explicitly declared", async () => {
    currentUser.value = await alice();
    const handler = secureHandler({ permission: "pii.reveal", revealsPii: true }, async () => ({ field: "address", value: "1 Real Street" }));
    expect(await (await handler(jsonRequest("POST", "/api/r"), ctx)).json()).toEqual({ field: "address", value: "1 Real Street" });
  });

  it("maps thrown errors to generic responses, audits 403/404, and hides details of 500s", async () => {
    currentUser.value = await alice();
    const notFound = secureHandler({ permission: "kyc.case.read" }, async () => {
      throw new NotFoundError("case cmxyz belongs to bob");
    });
    const res404 = await notFound(jsonRequest("GET", "/api/nf"), ctx);
    expect(res404.status).toBe(404);
    expect(await res404.json()).toEqual({ error: "Not found" });
    expect(await prisma.auditEvent.count({ where: { action: "access.denied", entityId: "GET /api/nf" } })).toBe(1);

    const forbidden = secureHandler({ permission: "kyc.case.read" }, async () => {
      throw new ForbiddenError("nope");
    });
    expect((await forbidden(jsonRequest("GET", "/api/fb"), ctx)).status).toBe(403);

    const crash = secureHandler({ permission: "kyc.case.read" }, async () => {
      throw new Error("database exploded with nationalId TEST-11112222");
    });
    const res500 = await crash(jsonRequest("GET", "/api/crash"), ctx);
    expect(res500.status).toBe(500);
    expect(await res500.json()).toEqual({ error: "Internal error" });
    expect(errorSpy).toHaveBeenCalled();
  });
});
