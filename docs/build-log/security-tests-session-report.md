# Session report: independent security test suite (`tests/security`)

- Branch: `security-tests`
- Scope: `tests/security/**` plus this report. No files under `src/`, `prisma/`, or the repo root were changed.
- Inputs used: `SECURITY.md` (all of it) and `SPEC.md` sections 8 (roles and permissions), 11 (test setup, API contract, `npm run test:security`) and 12 (seed data). Nothing under `src/` was read.

## What was built

A Playwright API-mode suite (`tests/security/playwright.config.ts`, one worker, serial) that treats the app as a black box on `http://localhost:3100` and, only where SPEC.md §11 allows it, imports `decideApproval` / `writeAuditEvent` and queries `test.db` through Prisma.

| Rule | Spec file | Tests | What it proves |
| --- | --- | --- | --- |
| M1 | `m1-authentication.spec.ts` | 9 | Every §11 API route is 401 anonymously; every protected page redirects to `/login`; forged / logged-out session cookies are rejected; all five seed users can log in |
| M2 | `m2-deny-by-default.spec.ts` | 36 (generated) | Every role with no grant gets 403 on every route, before input validation; 403 bodies carry no record data; undeclared routes and PUT/PATCH/DELETE/GET on state-changing routes never succeed |
| M3 | `m3-permissions-matrix.spec.ts` | 47 (generated) | Every role x every route in the §8 matrix (`none` -> 403, `all` -> 2xx, `assigned` -> 2xx on own case and 404 on another analyst's case); list scoping; role headers / body fields / cookies cannot escalate |
| M4 | `m4-record-level-access.spec.ts` | 9 | Analyst lists contain only assigned cases; out-of-scope and nonexistent ids are indistinguishable 404s on read, work and reveal routes; reassignment moves visibility |
| M5 | `m5-separation-of-duties.spec.ts` | 6 | Admin, auditor and analyst cannot decide (API and `decideApproval`); admin and auditor cannot reveal PII; approver can decide |
| M6 | `m6-maker-checker.spec.ts` | 5 | Requester cannot confirm or return their own request via `decideApproval` even when holding the approver role; a different approver can; API path agrees |
| M7 | `m7-final-outcomes.spec.ts` | 10 | Recommendations stop at `PENDING_APPROVAL`; status fields in bodies are ignored; decisions need a non-blank note (400); confirm/return transitions; no double decisions; final cases cannot be reopened |
| M8 | `m8-complete-audit.spec.ts` | 11 | Assign, start-review, recommend, decide and reveal each write an event with actor, role, action, entity, before/after, reason and timestamp; logged-in 403s and 404s are `access.denied`; `writeAuditEvent` joins the caller's transaction and a failing audit write rolls the state change back |
| M9 | `m9-append-only-audit.spec.ts` | 9 | Raw SQL and Prisma `UPDATE`/`DELETE` (single, bulk, in-transaction) on `AuditEvent` are rejected by triggers; inserts still work |
| M10 | `m10-pii-masking.spec.ts` | 15 | Every role sees masked `dateOfBirth`/`nationalId`/`address` in lists, details, approvals, audit and error bodies; reveal requires permission + record access + reason >= 10 chars, returns exactly one field and is audited |

`npx playwright test --list` discovers **175 tests in 10 files**; every test title starts with its rule id (`M1:` … `M10:`).

Helpers (`tests/security/helpers/`): `routes.ts` transcribes the §8 matrix and the §11 route list once so M2/M3 are generated from it; `api.ts` handles login/cookies; `cases.ts` drives the case lifecycle through the API to reach the state a test needs; `db.ts`, `audit.ts`, `pii.ts` hold the Prisma, audit-shape and masking assertions.

## Assumptions the app branch must satisfy (from SPEC.md)

- Seed password comes from `.env` / environment as `SEED_PASSWORD` (also accepts `SEED_USER_PASSWORD`, `DEV_PASSWORD`, `DEFAULT_PASSWORD`).
- Platform functions are imported from `src/platform/approvals` (`decideApproval`) and `src/platform/audit` (`writeAuditEvent`) with the signatures described in SPEC.md; adjust the two import lines if the module paths differ.
- `npm run test:security` should run `playwright test -c tests/security/playwright.config.ts`. The config starts `next dev --port 3100` with `DATABASE_URL=file:./test.db` unless `SECURITY_BASE_URL` points at an already-running app.

## Verification

- The suite was typechecked with `tsc --strict` (also with `noUncheckedIndexedAccess`) in a scratch project outside the repo that stubbed the two platform modules and generated a Prisma client from the §9 data model: 0 errors.
- The suite has **not** been executed against the application; the app is being built on another branch. Expect the first run to surface contract mismatches (route paths, error codes, audit action names such as `access.denied`) that should be resolved in favour of SPEC.md.

## Status

Complete for this session's scope; draft PR opened from `security-tests`.
