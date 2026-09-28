export const ROLES = ["analyst", "approver", "admin", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Role → permission map (SPEC.md section 8). Plain data: to add a permission for a new app,
 * add its string to the roles that should have it.
 *
 * "Assigned cases only" is not expressed here; it is enforced by each app's visibleWhere(user).
 */
export const ROLE_PERMISSIONS = {
  analyst: ["kyc.case.read", "kyc.case.work", "pii.reveal"],
  approver: ["kyc.case.read", "kyc.case.decide", "pii.reveal"],
  admin: ["kyc.case.read", "kyc.case.assign", "audit.read"],
  auditor: ["kyc.case.read", "audit.read"],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof ROLE_PERMISSIONS)[Role][number];

/**
 * Every `decidePermission` used by a registered approval action. The shared approvals inbox
 * and decide routes are gated on "any of" these; add your app's decide permission here.
 */
export const DECIDE_PERMISSIONS: readonly Permission[] = ["kyc.case.decide"];

export function can(user: { role: Role } | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  const granted: readonly string[] = ROLE_PERMISSIONS[user.role] ?? [];
  return granted.includes(permission);
}
