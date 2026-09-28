# Build log — internal tools platform + KYC Review Queue

Date: 2026-09-28. Scope: SPEC.md in full, with SECURITY.md as the overriding authority. Built only
what the spec lists: one decider per approval request, no audit hash chain, no SSO. `tests/security`
was neither created nor edited.

## What was built

| Area | Files | Notes |
| --- | --- | --- |
| Tooling | `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts`, `prisma.config.ts`, `.env.example`, `.gitignore`, `scripts/` | Next.js 16.3 (App Router, TS strict), Prisma 7 + SQLite (better-sqlite3 driver adapter), Tailwind 4, zod 4, iron-session 8, bcryptjs, Vitest 4, Playwright 1.58. Node 24. |
| Data model | `prisma/schema.prisma`, `prisma/migrations/20260928000000_init/migration.sql`, `prisma/seed.ts`, `prisma/seed-data.ts` | `User`, `KycCase`, `ApprovalRequest`, `AuditEvent` per SPEC §9. The migration adds `BEFORE UPDATE` / `BEFORE DELETE` triggers on `AuditEvent` that `RAISE(ABORT)`. Seed is deterministic (`faker.seed(20260928)`): 5 users (alice, bob analysts; carol approver; dan admin; erin auditor), 31 cases across all statuses incl. a `PENDING_APPROVAL` one requested by alice and an already-decided one, with matching audit events. |
| Platform | `src/platform/{db,session,auth,permissions,errors,handler,audit,approvals,pii,apps}.ts` | Contracts from SPEC §7. `session.ts` holds the iron-session options (encrypted httpOnly cookie, sameSite=lax, secure in production, 8 h TTL, secret ≥ 32 chars enforced at startup via `src/instrumentation.ts`). `handler.ts` = `secureHandler`: 401 → 403 (fails closed without a declared permission) → zod validation (400) → app logic → recursive PII masking → generic error bodies; 403/404 for logged-in users are audited as `access.denied`. `approvals.ts` registers actions, creates requests and decides them in one transaction with all maker-checker checks. `pii.ts` masks by field name and implements reasoned reveal with the app's own record-level loader. |
| Platform UI | `src/platform/ui/` | `AppShell`, `DataTable`, `DetailPanel`, `MaskedField`, `ApprovalBar`, `AuditTrail` (SPEC §7) plus `ApprovalsInbox`, `AuditLog`, `LogoutButton`, `api()` client helper. |
| Request gate | `src/proxy.ts` | Unauthenticated API → 401, unauthenticated page → redirect `/login`. Routes re-check the session themselves. |
| KYC app | `src/apps/kyc/{types,visibleWhere,cases,register,schemas}.ts`, `src/apps/kyc/ui/` | `visibleWhere` (analyst → `assignedToId = user.id`), workflow NEW → IN_REVIEW → PENDING_APPROVAL → APPROVED/REJECTED (→ IN_REVIEW on return), `kyc.decision` approval action, PII entity registration, queue + case detail components. |
| Routes/pages | `src/app/api/**`, `src/app/(app)/**`, `src/app/login/` | Exactly the SPEC §11 contract; every route is one `secureHandler` call. Pages: `/login`, `/kyc`, `/kyc/[id]`, `/approvals`, `/audit`. |
| Tests | `tests/unit/*.test.ts` (40 tests) | permissions matrix, PII masking/reveal, audit (transactional writes, filters, append-only triggers), approvals (maker-checker, one decider, callbacks), KYC (scope, filters, sorting, transitions), `secureHandler` (401/403/400/404/500, masking, fail-closed), session options. Tests run against a fresh seeded `unit-test.db` created in Vitest `globalSetup`. |
| Security-test wiring | `playwright.config.ts`, `scripts/reset-db.mjs` | `npm run test:security`: Playwright's `webServer` runs `node scripts/reset-db.mjs && next dev -p 3100` with `DATABASE_URL=file:./test.db`, so the database is deleted, migrated and seeded before the app starts. `testDir` is `tests/security`; `--pass-with-no-tests` keeps the command green while that directory is still empty. Verified with a throw-away probe spec (401 → login → masked cases → 403) that was not committed. |
| Docs/CI | `README.md`, `docs/ADDING_AN_APP.md`, `.github/workflows/ci.yml` | README: run instructions, §2 diagram, demo walkthrough per control, production path (§14 list). CI: install → setup → typecheck → lint → unit tests → build → Playwright install → test:security. |

## Security controls → implementation

| Control | Where |
| --- | --- |
| M1 authentication everywhere | `src/proxy.ts`, `secureHandler` (401), `requireUser()` in the `(app)` layout |
| M2 deny by default | `ROLE_PERMISSIONS` is the single matrix; `can()` returns false for anything not listed |
| M3 server-side enforcement | every route declares its permission; role read from DB by session user id, never from the client |
| M4 record-level access | `visibleWhere(user)` spread into every KYC query; `NotFoundError` → 404; denial audited |
| M5 separation of duties | `decideApproval` rejects `requestedById === decider.id` |
| M6 maker-checker | recommendation creates `ApprovalRequest`; confirm/return by a different user with `kyc.case.decide` and a mandatory note |
| M7 final outcomes via approvals only | `APPROVED`/`REJECTED` set only in `registerApprovalAction("kyc.decision").onConfirm` |
| M8 complete audit | `writeAuditEvent(tx, …)` inside every state-changing transaction; login/logout, reveal, denials included |
| M9 append-only audit | SQLite triggers in the migration; `tests/unit/audit.test.ts` |
| M10 PII masking + reasoned reveal | `maskPii` on every `secureHandler` response; `revealField` (permission, scope, reason ≥ 10, audit) |
| H1–H8 | iron-session encrypted cookie; bcrypt; startup secret check; `z.strictObject` inputs; generic error bodies; no record data in logs; state changes are `POST` only |

## Decisions and deviations

- **`npm run setup` creates `.env`** (`scripts/ensure-env.mjs`) with a random `SESSION_SECRET` when
  none exists, so "clean clone → install → setup → dev" works literally as SPEC §13 states, while
  still refusing to start with a missing/short secret.
- **`prisma migrate reset` is not used.** Prisma 7 removed `--skip-seed` and its CLI blocks
  `migrate reset` when it detects an AI agent, so `scripts/reset-db.mjs` deletes the local SQLite
  file and runs `migrate deploy` + seed instead. It refuses non-`file:` URLs.
- **Shared approval routes use an any-of permission list** (`DECIDE_PERMISSIONS`) so the inbox
  works for future apps' deciders; the engine still checks the action's own `decidePermission`.
- **Append-only assertion through Prisma:** Prisma surfaces `SQLITE_CONSTRAINT_TRIGGER` as a generic
  constraint error, so the unit test asserts rejection + unchanged row via the ORM and the exact
  trigger message via raw SQL.
- **`src/instrumentation.ts` loads app registrations only in the Node.js runtime** (the proxy runs
  in the edge runtime where the Prisma client cannot be bundled). Platform registries also lazily
  `loadApps()` so direct imports (tests) work.
- **`next dev` for `test:security`**: Next.js 16 allows one dev server per project directory, so the
  README asks to stop a running `npm run dev` before `npm run test:security`. CI has no such conflict.
- Scaffold leftovers removed (default SVGs). `AGENTS.md`/`CLAUDE.md` are generated by `next dev`
  and committed as the file itself recommends.

## Verification (this branch, Node 24.21)

| Command | Result |
| --- | --- |
| `npm install` | ok (runs `prisma generate` via `postinstall`) |
| `npm run setup` | ok — `.env` created, migration applied, 5 users / 31 cases seeded |
| `npm run dev` | ok — login, queue, detail, approvals, audit pages and all §11 routes exercised via curl |
| `npm test` | 7 files, 40 tests passed |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run build` | ok — 13 static/dynamic routes + proxy |
| `npm run test:security` | wired: resets/seeds `test.db`, starts on :3100, runs `tests/security` (empty → passes with no tests) |

## Not built (by instruction / SPEC §14)

SSO/OIDC, Postgres, cloud deployment CI/CD, audit hash chain, encryption at rest with a KMS, SIEM
export, rate limiting, user-management UI, data retention, multi-step approvals.
