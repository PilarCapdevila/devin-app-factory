/** Roles from SPEC.md §8. */
export const ROLES = ["analyst", "approver", "admin", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export interface SeedUser {
  readonly email: string;
  readonly role: Role;
}

/** Deterministic seed users from SPEC.md §12. */
export const USERS = {
  alice: { email: "alice@example.com", role: "analyst" },
  bob: { email: "bob@example.com", role: "analyst" },
  carol: { email: "carol@example.com", role: "approver" },
  dan: { email: "dan@example.com", role: "admin" },
  erin: { email: "erin@example.com", role: "auditor" },
} as const satisfies Record<string, SeedUser>;

export type UserKey = keyof typeof USERS;

/** One representative user per role, used when iterating the permission matrix. */
export const USER_FOR_ROLE: Record<Role, UserKey> = {
  analyst: "alice",
  approver: "carol",
  admin: "dan",
  auditor: "erin",
};

/** The analyst who is *not* the given analyst; used for "someone else's case" scenarios. */
export function otherAnalyst(key: "alice" | "bob"): "alice" | "bob" {
  return key === "alice" ? "bob" : "alice";
}
