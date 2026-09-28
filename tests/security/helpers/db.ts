import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, type Prisma } from "./platform";
import { TEST_DATABASE_URL } from "./config";
import { ROLES, USERS, type Role, type UserKey } from "./users";

// `npm run test:security` sets DATABASE_URL=file:./test.db (SPEC.md §11); default it for ad-hoc runs.
process.env.DATABASE_URL ??= TEST_DATABASE_URL;

/**
 * Single Prisma client for direct database assertions (SPEC.md §11 allows the security
 * suite to use Prisma against `test.db`). Kept in one place so the construction can be
 * adapted without touching any test. The schema generates the client into
 * `src/generated/prisma` and uses the better-sqlite3 driver adapter.
 */
export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL }) });

/**
 * A transaction client on which every operation fails, simulating an audit store that cannot
 * be written to. Whatever `writeAuditEvent` calls on it (`tx.auditEvent.create`,
 * `tx.$executeRaw`, ...) rejects with `reason`.
 */
export function failingTransactionClient(reason = "simulated audit storage failure"): Prisma.TransactionClient {
  const target = (): never => {
    throw new Error(reason);
  };
  const failing: object = new Proxy(target, {
    get: () => failing,
    apply: () => Promise.reject(new Error(reason)),
  });
  return new Proxy({}, { get: () => failing }) as Prisma.TransactionClient;
}

export interface DbUser {
  id: string;
  email: string;
  role: Role;
}

function asRole(value: string): Role {
  const role = ROLES.find((r) => r === value);
  if (!role) throw new Error(`seeded user has unknown role ${JSON.stringify(value)}; expected one of ${ROLES.join(", ")}`);
  return role;
}

const userCache = new Map<UserKey, DbUser>();

export async function dbUser(key: UserKey): Promise<DbUser> {
  const cached = userCache.get(key);
  if (cached) return cached;
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: USERS[key].email },
    select: { id: true, email: true, role: true },
  });
  const typed: DbUser = { ...user, role: asRole(user.role) };
  userCache.set(key, typed);
  return typed;
}

export interface DbCase {
  id: string;
  status: string;
  assignedToId: string | null;
  applicantName: string;
  dateOfBirth: unknown;
  nationalId: string;
  address: string;
}

export async function dbCase(id: string): Promise<DbCase> {
  return prisma.kycCase.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      status: true,
      assignedToId: true,
      applicantName: true,
      dateOfBirth: true,
      nationalId: true,
      address: true,
    },
  });
}

export async function dbCases(): Promise<DbCase[]> {
  return prisma.kycCase.findMany({
    select: {
      id: true,
      status: true,
      assignedToId: true,
      applicantName: true,
      dateOfBirth: true,
      nationalId: true,
      address: true,
    },
  });
}

export interface DbApprovalRequest {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  requestedById: string;
  decidedById: string | null;
  decisionNote: string | null;
}

export async function dbApprovalRequest(id: string): Promise<DbApprovalRequest> {
  return prisma.approvalRequest.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      action: true,
      status: true,
      requestedById: true,
      decidedById: true,
      decisionNote: true,
    },
  });
}

export async function pendingRequestFor(entityId: string): Promise<DbApprovalRequest> {
  return prisma.approvalRequest.findFirstOrThrow({
    where: { entityId, status: "PENDING" },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      action: true,
      status: true,
      requestedById: true,
      decidedById: true,
      decisionNote: true,
    },
  });
}
