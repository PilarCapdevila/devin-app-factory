import { expect } from "@playwright/test";

/**
 * Asserts that a platform call rejects with an error whose class name, `name` or message
 * matches `kind` (e.g. /forbidden/i, /validation/i). The platform's error classes are
 * deliberately not imported so the suite stays independent of `src/platform/handler.ts`.
 */
export async function expectRejectsLike(promise: Promise<unknown>, kind: RegExp): Promise<Error> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected rejection matching ${kind}`).toBeInstanceOf(Error);
  const error = caught as Error;
  const description = `${error.constructor.name} ${error.name} ${error.message}`;
  expect(description, `expected error matching ${kind}, got "${description}"`).toMatch(kind);
  return error;
}

export const FORBIDDEN = /forbidden/i;
export const VALIDATION = /validation|invalid|required/i;
