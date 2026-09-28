import type { Role } from "./users";

/** Permissions from the SPEC.md §8 matrix. */
export const PERMISSIONS = [
  "kyc.case.read",
  "kyc.case.work",
  "kyc.case.decide",
  "kyc.case.assign",
  "pii.reveal",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** `all` = ✓, `assigned` = "assigned cases only", `none` = —. */
export type Grant = "all" | "assigned" | "none";

/** The SPEC.md §8 matrix, transcribed verbatim. */
export const MATRIX: Record<Permission, Record<Role, Grant>> = {
  "kyc.case.read": { analyst: "assigned", approver: "all", admin: "all", auditor: "all" },
  "kyc.case.work": { analyst: "assigned", approver: "none", admin: "none", auditor: "none" },
  "kyc.case.decide": { analyst: "none", approver: "all", admin: "none", auditor: "none" },
  "kyc.case.assign": { analyst: "none", approver: "none", admin: "all", auditor: "none" },
  "pii.reveal": { analyst: "assigned", approver: "all", admin: "none", auditor: "none" },
  "audit.read": { analyst: "none", approver: "none", admin: "all", auditor: "all" },
};

export type Method = "GET" | "POST";

/**
 * Values a route needs to be exercised. Filled per test from live state so allowed calls hit a
 * case in the right workflow state, and denied calls hit an existing record (so a 403 cannot be
 * confused with a 404 for a missing row).
 */
export interface RouteParams {
  caseId: string;
  requestId: string;
  analystId: string;
}

export interface ProtectedRoute {
  /** Human-readable name used in test titles. */
  name: string;
  method: Method;
  path: (p: RouteParams) => string;
  body?: (p: RouteParams) => Record<string, unknown>;
  permission: Permission;
  /** Whether the route acts on a single KYC case (so "assigned cases only" applies). */
  caseScoped: boolean;
}

/** Every permission-gated route of the SPEC.md §11 contract. */
export const PROTECTED_ROUTES: readonly ProtectedRoute[] = [
  {
    name: "GET /api/kyc/cases",
    method: "GET",
    path: () => "/api/kyc/cases",
    permission: "kyc.case.read",
    caseScoped: false,
  },
  {
    name: "GET /api/kyc/cases/:id",
    method: "GET",
    path: (p) => `/api/kyc/cases/${p.caseId}`,
    permission: "kyc.case.read",
    caseScoped: true,
  },
  {
    name: "POST /api/kyc/cases/:id/assign",
    method: "POST",
    path: (p) => `/api/kyc/cases/${p.caseId}/assign`,
    body: (p) => ({ analystId: p.analystId }),
    permission: "kyc.case.assign",
    caseScoped: true,
  },
  {
    name: "POST /api/kyc/cases/:id/start-review",
    method: "POST",
    path: (p) => `/api/kyc/cases/${p.caseId}/start-review`,
    permission: "kyc.case.work",
    caseScoped: true,
  },
  {
    name: "POST /api/kyc/cases/:id/recommend",
    method: "POST",
    path: (p) => `/api/kyc/cases/${p.caseId}/recommend`,
    body: () => ({ recommendation: "approve", note: "Recommendation from the security suite" }),
    permission: "kyc.case.work",
    caseScoped: true,
  },
  {
    name: "POST /api/kyc/cases/:id/reveal",
    method: "POST",
    path: (p) => `/api/kyc/cases/${p.caseId}/reveal`,
    body: () => ({ field: "nationalId", reason: "Security suite verification of reveal" }),
    permission: "pii.reveal",
    caseScoped: true,
  },
  {
    name: "POST /api/approvals/:id/decide",
    method: "POST",
    path: (p) => `/api/approvals/${p.requestId}/decide`,
    body: () => ({ decision: "return", note: "Returned by the security suite" }),
    permission: "kyc.case.decide",
    caseScoped: false,
  },
  {
    name: "GET /api/audit",
    method: "GET",
    path: () => "/api/audit",
    permission: "audit.read",
    caseScoped: false,
  },
];

export function routeNamed(name: string): ProtectedRoute {
  const route = PROTECTED_ROUTES.find((r) => r.name === name);
  if (!route) throw new Error(`Unknown route ${name}`);
  return route;
}

/** Routes that require a session but are not gated by a §8 permission. */
export const SESSION_ONLY_ROUTES: ReadonlyArray<{ name: string; method: Method; path: string }> = [
  { name: "POST /api/auth/logout", method: "POST", path: "/api/auth/logout" },
  { name: "GET /api/approvals", method: "GET", path: "/api/approvals" },
];

/** Placeholder identifiers for unauthenticated calls, where no record lookup should happen. */
export const PLACEHOLDER_PARAMS: RouteParams = {
  caseId: "00000000-0000-0000-0000-000000000000",
  requestId: "00000000-0000-0000-0000-000000000000",
  analystId: "00000000-0000-0000-0000-000000000000",
};

/** Platform pages that must redirect anonymous visitors to `/login` (SPEC.md §7, §10). */
export const PROTECTED_PAGES = ["/", "/approvals", "/audit"] as const;
