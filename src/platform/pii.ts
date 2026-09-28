import { writeAuditEvent } from "./audit";
import { loadApps } from "./apps";
import type { SessionUser } from "./auth";
import { withTransaction, type Tx } from "./db";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { can } from "./permissions";

/** Global list of sensitive field names. Future apps add their fields here. */
export const PII_FIELD_NAMES = ["dateOfBirth", "nationalId", "address", "customerEmail"] as const;
export type PiiField = (typeof PII_FIELD_NAMES)[number];

export const MASK = "••••••";
export const MIN_REVEAL_REASON_LENGTH = 10;

export function isPiiField(name: string): name is PiiField {
  return (PII_FIELD_NAMES as readonly string[]).includes(name);
}

/** `nationalId` keeps its last 4 characters; every other PII field becomes `••••••`. */
export function maskValue(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (field === "nationalId") {
    const text = String(value);
    return `${MASK}${text.slice(-4)}`;
  }
  return MASK;
}

/** Recursively masks every PII field in a JSON-serialisable value. */
export function maskPii<T>(data: T): T {
  if (Array.isArray(data)) return data.map((item) => maskPii(item)) as T;
  if (data instanceof Date) return data;
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      out[key] = isPiiField(key) ? maskValue(key, value) : maskPii(value);
    }
    return out as T;
  }
  return data;
}

/**
 * How the platform finds a record for a PII reveal. Each app registers its entity types with
 * a loader that applies the app's own visibleWhere(user), so record-level access is reused.
 */
export type PiiEntity = {
  find(tx: Tx, user: SessionUser, entityId: string): Promise<Record<string, unknown> | null>;
};

const piiEntities = new Map<string, PiiEntity>();

export function registerPiiEntity(entityType: string, entity: PiiEntity): void {
  piiEntities.set(entityType, entity);
}

export type RevealFieldInput = {
  user: SessionUser;
  entityType: string;
  entityId: string;
  field: string;
  reason: string;
};

/**
 * Returns one unmasked PII value after checking `pii.reveal`, record-level access and the
 * reason, and writes a `pii.reveal` audit event in the same transaction.
 */
export async function revealField({ user, entityType, entityId, field, reason }: RevealFieldInput) {
  if (!can(user, "pii.reveal")) throw new ForbiddenError("Missing pii.reveal permission");
  if (!isPiiField(field)) throw new ValidationError("Unknown PII field");
  if (reason.trim().length < MIN_REVEAL_REASON_LENGTH) {
    throw new ValidationError(`Reason must be at least ${MIN_REVEAL_REASON_LENGTH} characters`);
  }

  await loadApps();
  const entity = piiEntities.get(entityType);
  if (!entity) throw new ValidationError("Unknown entity type");

  return withTransaction(async (tx) => {
    const record = await entity.find(tx, user, entityId);
    if (!record) throw new NotFoundError();
    await writeAuditEvent(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "pii.reveal",
      entityType,
      entityId,
      after: { field },
      reason,
    });
    return { field, value: String(record[field] ?? "") };
  });
}
