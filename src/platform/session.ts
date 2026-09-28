import type { SessionOptions } from "iron-session";

export const SESSION_COOKIE_NAME = "its_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

export type SessionData = { userId?: string };

/** Reads and validates the session secret (SECURITY.md H3). Throws if missing or too short. */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long`);
  }
  return secret;
}

/** Cookie settings per SECURITY.md H1: encrypted, httpOnly, sameSite=lax, secure in production, 8h. */
export function getSessionOptions(): SessionOptions {
  return {
    cookieName: SESSION_COOKIE_NAME,
    password: getSessionSecret(),
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}
