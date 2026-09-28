import { expect } from "@playwright/test";
import type { DbCase } from "./db";

/** PII field names from SPEC.md §7 (`PII_FIELD_NAMES`). */
export const PII_FIELDS = ["dateOfBirth", "nationalId", "address"] as const;
export type PiiField = (typeof PII_FIELDS)[number];

/** The mask for every PII field except `nationalId` (SPEC.md §7 `maskValue`). */
export const FULL_MASK = "••••••";

/** Every string form in which a raw PII value could leak into a JSON response. */
export function rawPiiStrings(kycCase: Pick<DbCase, "dateOfBirth" | "nationalId" | "address">): string[] {
  const values = [kycCase.nationalId, kycCase.address];
  const dob = kycCase.dateOfBirth;
  if (dob instanceof Date) {
    values.push(dob.toISOString(), dob.toISOString().slice(0, 10));
  } else if (typeof dob === "string") {
    values.push(dob, dob.slice(0, 10));
  }
  return values.filter((v) => v.length > 0);
}

/** Recursively collects every string value in a JSON document (including stringified nested JSON). */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    if (value.startsWith("{") || value.startsWith("[")) {
      try {
        collectStrings(JSON.parse(value) as unknown, out);
      } catch {
        // plain string, not embedded JSON
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectStrings(v, out));
  } else if (typeof value === "object" && value !== null) {
    Object.values(value).forEach((v) => collectStrings(v, out));
  }
  return out;
}

/** Fails if any raw PII value of the given cases appears anywhere in `body`. */
export function expectNoRawPii(body: unknown, cases: ReadonlyArray<Pick<DbCase, "dateOfBirth" | "nationalId" | "address">>): void {
  const strings = collectStrings(body);
  const raw = new Set(cases.flatMap(rawPiiStrings));
  for (const s of strings) {
    for (const value of raw) {
      expect(s, `raw PII value leaked in response`).not.toContain(value);
    }
  }
}

/** Asserts a single API-returned case has every PII field masked per SPEC.md §7. */
export function expectMaskedCase(apiCase: Record<string, unknown>, raw: DbCase): void {
  expect(apiCase.dateOfBirth).toBe(FULL_MASK);
  expect(apiCase.address).toBe(FULL_MASK);
  const nationalId = apiCase.nationalId;
  expect(typeof nationalId).toBe("string");
  const masked = String(nationalId);
  expect(masked).not.toBe(raw.nationalId);
  expect(masked.endsWith(raw.nationalId.slice(-4)), "masked nationalId keeps only the last 4 characters").toBe(true);
  // Nothing before the last 4 characters may survive.
  const prefix = raw.nationalId.slice(0, -4);
  if (prefix.length > 0) expect(masked).not.toContain(prefix);
}
