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
| M10 | `m10-pii-masking.spec.ts` | 23 | Every role sees masked `dateOfBirth`/`nationalId`/`address` in lists, details, approvals, audit and error bodies; reveal requires permission + record access + reason >= 10 chars, returns exactly one field and is audited |

`npx playwright test --list` discovers **175 tests in 10 files**; every test title starts with its rule id (`M1:` … `M10:`).

Helpers (`tests/security/helpers/`): `routes.ts` transcribes the §8 matrix and the §11 route list once so M2/M3 are generated from it; `api.ts` handles login/cookies; `cases.ts` drives the case lifecycle through the API to reach the state a test needs; `db.ts`, `audit.ts`, `pii.ts` hold the Prisma, audit-shape and masking assertions; `platform.ts` / `platform-loader.ts` load the two permitted platform modules and the generated Prisma client.

## How the suite runs

`npm run test:security` runs `playwright test --config tests/security/playwright.config.ts`. The config's `webServer` runs `npm run db:reset && npx next dev --port 3100` from the repo root with `DATABASE_URL=file:./test.db` and `PORT=3100`, so every run starts from a freshly migrated and seeded `test.db`. Set `SECURITY_BASE_URL` to point the suite at an already-running app instead. Tests run serially in one worker because they mutate shared seed data.

The app's platform modules and generated Prisma client (`src/generated/prisma`, Prisma 7 with the better-sqlite3 adapter) are ESM-only TypeScript with extensionless and `@/` imports that Playwright's built-in transform cannot compile. `tests/security/package.json` (`"type": "module"`) makes the suite ESM, `build.external` keeps Playwright away from `src/**`, and `helpers/platform-loader.ts` registers Node module hooks that resolve those imports and type-strip the sources with `node:module`'s `stripTypeScriptTypes`. Only the files under `src/` are affected; spec files keep Playwright's transform and source maps.

## Session 2: rebase onto `main` and first run against the application

After the application was merged into `main`, `security-tests` was rebased onto it, the report moved to this path, the `webServer` command switched to the reset-and-seed form above, and the suite was executed with `npm run test:security`.

Changes needed to make the suite compile and load against the real app (all under `tests/security`):

- `helpers/db.ts`: Prisma client now comes from the generated `src/generated/prisma/client` via the better-sqlite3 adapter (the `@prisma/client` package no longer exports `PrismaClient` in this Prisma 7 layout); seeded roles are narrowed to the `Role` union at runtime.
- `helpers/platform.ts` + `helpers/platform-loader.ts`: module loading described above; the five spec files that call `decideApproval` / `writeAuditEvent` import them from `helpers/platform`.
- `helpers/pii.ts`: `expectNoRawPii` collects leaks with plain string checks and makes a single assertion. The previous version called `expect(...).not.toContain` once per (string, PII value) pair, which on the audit log body took minutes of synchronous work and tripped the 30 s test timeout without any application fault.

Result of `npm run test:security` on the merged application (fresh `test.db`, single worker):

| Rule | Tests | Result |
|---|---|---|
| M1 Authentication everywhere | 19 | pass |
| M2 Deny by default | 36 | pass |
| M3 Server-side permissions (every role x every route) | 47 | pass |
| M4 Record-level access | 9 | pass |
| M5 Separation of duties | 6 | pass |
| M6 Maker-checker | 5 | pass |
| M7 Final outcomes only through approvals | 10 | pass |
| M8 Complete, transactional audit | 11 | pass |
| M9 Append-only audit | 9 | pass |
| M10 PII masked by default | 23 | pass |
| **Total** | **175** | **175 passed, 0 failed** (27 s) |

No test contradicts SECURITY.md or SPEC.md §8/§11/§12 as written; no application code was changed. `npm run typecheck` and `eslint tests/security` are clean.

## Status

Suite green against `main`; draft PR #1 updated from `security-tests`.
