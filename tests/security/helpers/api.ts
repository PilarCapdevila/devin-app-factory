import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { BASE_URL, seedPassword } from "./config";
import { USERS, type UserKey, type SeedUser } from "./users";

/** An authenticated API client bound to one seeded user. */
export interface Session {
  readonly key: UserKey;
  readonly user: SeedUser;
  readonly api: APIRequestContext;
}

/** A client with no session cookie at all. */
export async function anonymous(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL });
}

export type Cookie = Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"][number];

/** A client pre-loaded with the given cookies and nothing else. */
export async function withCookies(cookies: Cookie[]): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL, storageState: { cookies, origins: [] } });
}

/** Cookie for the app's host, e.g. to plant a spoofed value next to a real session cookie. */
export function hostCookie(name: string, value: string): Cookie {
  return {
    name,
    value,
    domain: new URL(BASE_URL).hostname,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };
}

/** Logs in through the public login route; the returned context carries the session cookie. */
export async function login(key: UserKey): Promise<Session> {
  const user = USERS[key];
  const api = await request.newContext({ baseURL: BASE_URL });
  const response = await api.post("/api/auth/login", {
    data: { email: user.email, password: seedPassword() },
  });
  if (response.status() !== 200) {
    throw new Error(`login failed for ${user.email}: HTTP ${response.status()} ${await response.text()}`);
  }
  return { key, user, api };
}

export async function logout(session: Session): Promise<APIResponse> {
  return session.api.post("/api/auth/logout");
}

export async function dispose(...contexts: ReadonlyArray<Session | APIRequestContext>): Promise<void> {
  await Promise.all(contexts.map((c) => ("api" in c ? c.api.dispose() : c.dispose())));
}

/** Parses a JSON body, failing loudly with the raw text when the body is not JSON. */
export async function json(response: APIResponse): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Expected JSON body for ${response.url()} (HTTP ${response.status()}), got: ${text}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown, what = "response body"): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Expected ${what} to be an object, got ${JSON.stringify(value)}`);
  return value;
}

export function asArray(value: unknown, what = "response body"): unknown[] {
  if (Array.isArray(value)) return value;
  // Tolerate list responses wrapped as { items: [...] } / { data: [...] } / { cases: [...] }.
  if (isRecord(value)) {
    for (const key of ["items", "data", "cases", "requests", "events", "results"]) {
      const inner = value[key];
      if (Array.isArray(inner)) return inner;
    }
  }
  throw new Error(`Expected ${what} to be an array, got ${JSON.stringify(value)}`);
}

export function asString(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${what} to be a string, got ${JSON.stringify(value)}`);
  return value;
}

/** `id` of every object in a list response. */
export function idsOf(items: unknown[]): string[] {
  return items.flatMap((item) => (isRecord(item) && typeof item.id === "string" ? [item.id] : []));
}
