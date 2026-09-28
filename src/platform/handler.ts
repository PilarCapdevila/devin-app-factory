import type { ZodType } from "zod";
import { writeAuditEvent } from "./audit";
import { getCurrentUser, type SessionUser } from "./auth";
import { prisma } from "./db";
import { HttpError, ValidationError } from "./errors";
import { can, type Permission } from "./permissions";
import { maskPii } from "./pii";

export { HttpError, ValidationError, ForbiddenError, NotFoundError } from "./errors";

export type SecureHandlerOptions<Input> = {
  /**
   * Required. A handler without a permission fails closed (403 for every call).
   * A list means "any of" (used by platform routes shared across apps).
   */
  permission: Permission | readonly Permission[];
  /** Skip response masking. Only for routes whose purpose is to return one PII value. */
  revealsPii?: boolean;
  /** Validates the JSON body (POST) or query string (GET). Use z.strictObject so unknown fields are rejected. */
  input?: ZodType<Input>;
};

export type HandlerContext<Input> = {
  user: SessionUser;
  input: Input;
  params: Record<string, string>;
  request: Request;
};

type RouteContext = { params: Promise<Record<string, string>> };
export type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

const GENERIC_MESSAGES: Record<number, string> = {
  400: "Invalid input",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  500: "Internal error",
};

async function auditDenied(user: SessionUser, request: Request, status: number, detail: string) {
  const path = new URL(request.url).pathname;
  try {
    await writeAuditEvent(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: "access.denied",
      entityType: "route",
      entityId: `${request.method} ${path}`,
      after: { status },
      reason: detail,
    });
  } catch (error) {
    console.error("[secureHandler] failed to audit denial", error instanceof Error ? error.message : error);
  }
}

function requiredPermissions(permission: Permission | readonly Permission[] | undefined): readonly Permission[] {
  if (!permission) return [];
  return Array.isArray(permission) ? (permission as readonly Permission[]) : [permission as Permission];
}

async function readInput<Input>(request: Request, schema: ZodType<Input>): Promise<Input> {
  let raw: unknown;
  if (request.method === "GET" || request.method === "HEAD") {
    raw = Object.fromEntries(new URL(request.url).searchParams);
  } else {
    const text = await request.text();
    if (text.trim() === "") {
      raw = {};
    } else {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new ValidationError("Body is not valid JSON");
      }
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  return parsed.data;
}

/**
 * Wraps a route: authenticate → check permission → validate input → run → mask PII.
 * Denials (403/404) for a logged-in user are audited as `access.denied`.
 * Every error becomes a generic response; details are logged server-side only.
 */
export function secureHandler<Input = undefined>(
  options: SecureHandlerOptions<Input>,
  fn: (ctx: HandlerContext<Input>) => Promise<unknown>,
): RouteHandler {
  return async (request, context) => {
    const user = await getCurrentUser();
    const required = requiredPermissions(options.permission);

    if (required.length === 0) {
      if (user) await auditDenied(user, request, 403, "Route declares no permission");
      return json(403, { error: GENERIC_MESSAGES[403] });
    }
    if (!user) return json(401, { error: GENERIC_MESSAGES[401] });
    if (!required.some((permission) => can(user, permission))) {
      await auditDenied(user, request, 403, `Missing permission ${required.join(" | ")}`);
      return json(403, { error: GENERIC_MESSAGES[403] });
    }

    try {
      const input = options.input ? await readInput(request, options.input) : (undefined as Input);
      const params = context?.params ? await context.params : {};
      const result = await fn({ user, input, params, request });
      const body = options.revealsPii ? result : maskPii(result);
      return json(200, body ?? {});
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 403 || error.status === 404) {
          await auditDenied(user, request, error.status, error.message);
        }
        return json(error.status, { error: GENERIC_MESSAGES[error.status] ?? "Error" });
      }
      console.error("[secureHandler]", request.method, new URL(request.url).pathname, error instanceof Error ? error.message : "unknown error");
      return json(500, { error: GENERIC_MESSAGES[500] });
    }
  };
}
