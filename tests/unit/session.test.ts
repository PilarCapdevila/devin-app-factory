import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, getSessionOptions, getSessionSecret } from "@/platform/session";

const original = process.env.SESSION_SECRET;

describe("session configuration (SECURITY.md H1, H3)", () => {
  afterEach(() => {
    process.env.SESSION_SECRET = original;
  });

  it("refuses a missing or short secret", () => {
    delete process.env.SESSION_SECRET;
    expect(() => getSessionSecret()).toThrow(/SESSION_SECRET/);
    process.env.SESSION_SECRET = "too-short";
    expect(() => getSessionSecret()).toThrow(/32/);
  });

  it("uses an httpOnly, sameSite=lax, 8 hour cookie", () => {
    process.env.SESSION_SECRET = "a-valid-secret-that-is-long-enough-for-tests";
    const options = getSessionOptions();
    expect(options.cookieName).toBe(SESSION_COOKIE_NAME);
    expect(options.ttl).toBe(SESSION_TTL_SECONDS);
    expect(SESSION_TTL_SECONDS).toBe(8 * 60 * 60);
    expect(options.cookieOptions).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(options.cookieOptions?.secure).toBe(false);
  });
});
