import bcrypt from "bcryptjs";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { writeAuditEvent } from "./audit";
import { prisma, withTransaction } from "./db";
import { isRole, type Role } from "./permissions";
import { getSessionOptions, type SessionData } from "./session";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

async function getSession() {
  return getIronSession<SessionData>(await cookies(), getSessionOptions());
}

function toSessionUser(user: { id: string; email: string; name: string; role: string }): SessionUser | null {
  if (!isRole(user.role)) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/**
 * Verifies credentials, starts a session and returns the user, or returns null.
 * SSO-ready: replacing this with an OIDC callback only needs to set `session.userId`.
 */
export async function login(email: string, password: string): Promise<SessionUser | null> {
  const record = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!record) return null;
  const ok = await bcrypt.compare(password, record.passwordHash);
  if (!ok) return null;
  const user = toSessionUser(record);
  if (!user) return null;

  const session = await getSession();
  session.userId = user.id;
  await session.save();

  await withTransaction((tx) =>
    writeAuditEvent(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
    }),
  );
  return user;
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  const session = await getSession();
  session.destroy();
  if (user) {
    await withTransaction((tx) =>
      writeAuditEvent(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: "auth.logout",
        entityType: "user",
        entityId: user.id,
      }),
    );
  }
}

/**
 * The authenticated user for the current request, or null. The role always comes from the
 * database row referenced by the encrypted session cookie, never from client input.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const record = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!record) return null;
  return toSessionUser(record);
}

/** For pages: returns the current user or redirects to /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
