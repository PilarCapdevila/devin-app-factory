# Internal Tools Platform — Prototype Spec

## 1. Purpose

A minimal internal-tools foundation for a fintech operations team. It replicates the core value of a platform like Microsoft Power Apps: secure-by-default building blocks (authentication, permissions, audit, approvals, PII protection) that every internal app inherits automatically.

This repo contains:
1. **The platform** (`src/platform`): shared security and UI building blocks.
2. **One reference app** (`src/apps/kyc`): a KYC Review Queue built only from platform building blocks.

Future apps (refunds dashboard, dispute queue, etc.) must be buildable on this platform without re-implementing any security.

## 2. Principles

- **SECURITY.md overrides this document.** If anything conflicts, follow SECURITY.md.
- Security is enforced in the platform, never in individual apps. An app cannot opt out.
- Deny by default. Server-side enforcement only; hiding things in the UI is cosmetic.
- Boring, simple technology. No extra services, no external network calls.
- Prefer clarity over cleverness: a reviewer new to the codebase should understand it quickly.

## 3. Stack

- Next.js (latest stable, App Router), TypeScript in strict mode
- SQLite via Prisma (a single local file; no database server needed)
- Tailwind CSS for styling
- zod for input validation
- Vitest for unit tests; Playwright (API testing mode) for security tests
- Session auth: encrypted, httpOnly cookie (e.g. iron-session). Login page with seeded users. All auth logic lives behind `src/platform/auth.ts` so an OIDC/SSO provider (Okta, Microsoft Entra ID) can replace it later without touching app code.

## 4. Structure

```
src/
  platform/              ← the foundation. Apps import from here.
    auth.ts              session handling, getCurrentUser()
    permissions.ts       role → permission map, can(), requirePermission()
    handler.ts           secureHandler(): wraps EVERY server action / API route
    audit.ts             append-only, hash-chained audit writer + verifyChain()
    approvals.ts         generic maker-checker engine (reusable by any app)
    pii.ts               server-side masking + revealField() with reason
    ui/                  AppShell, DataTable, DetailPanel, MaskedField,
                         ApprovalBar, AuditTrail
  apps/
    kyc/                 KYC Review Queue (reference app)
  app/                   Next.js pages + API routes — thin, delegate to src/apps/*
prisma/
  schema.prisma
  migrations/            includes raw SQL triggers making AuditEvent append-only
  seed.ts
tests/
  unit/                  Session A's own tests
  security/              RESERVED for independent security tests written separately.
                         Do not create or edit files here.
docs/
  ADDING_AN_APP.md       how to build a new app on the platform
```

**Rules:**
- All data reads and writes go through JSON API routes under `src/app/api` (see section 9). Pages fetch from these routes. Do not use server actions.
- Every API route must be wrapped in `secureHandler({ permission, ... })`. A handler without a declared permission must fail closed.

## 5. Roles and permissions

Roles: `analyst`, `approver`, `admin`, `auditor`.

| Permission | analyst | approver | admin | auditor |
|---|---|---|---|---|
| `kyc.case.read` | assigned cases only | all | all | all |
| `kyc.case.recommend` (submit approve/reject recommendation) | assigned cases only | — | — | — |
| `kyc.case.approve` (final decision on a recommendation) | — | ✓ | — | — |
| `kyc.case.assign` | — | — | ✓ | — |
| `pii.reveal` | assigned cases only | ✓ | — | — |
| `audit.read` | — | — | ✓ | ✓ |

Note the deliberate separation of duties: **admin can assign work but cannot approve decisions or reveal PII.** Auditor is read-only.

The permission map must be defined in a single place (`permissions.ts`) as plain data so it is easy to review.

## 6. Data model

- **User**: id, email, name, role, passwordHash
- **KycCase**: id, applicantName, dateOfBirth (PII), nationalId (PII), address (PII), riskScore (0–100), riskFlags (list), status, assignedToId, createdAt, updatedAt
  - Status flow: `NEW → IN_REVIEW → PENDING_APPROVAL → APPROVED | REJECTED`, and `PENDING_APPROVAL → IN_REVIEW` when an approver returns a case.
- **ApprovalRequest** (generic, reused by all future apps): id, entityType, entityId, action, payload (JSON), requestedById, requestedAt, requestNote, status (`PENDING | CONFIRMED | RETURNED`), decidedById, decidedAt, decisionNote
- **AuditEvent**: id, timestamp (server time), actorId, actorRole, action, entityType, entityId, before (JSON), after (JSON), reason, prevHash, hash

## 7. KYC Review Queue requirements

**Queue page**
- Table of cases the current user is allowed to see (record-level rules apply).
- Filter by status and risk level; sort by risk score (highest first by default).
- PII columns shown masked (e.g. `***-**-1234`).

**Case detail page**
- Applicant info with PII masked. Each PII field has a "Reveal" button that asks for a reason; the revealed value is shown only for that field, only in that view.
- Risk score and risk flags.
- Audit trail for this case (who did what, when).
- Action bar that only shows actions the user is permitted to take (server still enforces).

**Workflow**
1. Admin assigns a `NEW` case to an analyst.
2. Analyst clicks "Start review" (a POST, never triggered by just viewing the page) → status `IN_REVIEW`.
3. Analyst submits a recommendation (approve or reject) with a note → creates an ApprovalRequest; status `PENDING_APPROVAL`.
4. An approver (never the same person who requested) either **confirms** the recommendation (case becomes `APPROVED` or `REJECTED` accordingly) or **returns** it to the analyst with a note (case goes back to `IN_REVIEW`).
5. Final status is set only by the approvals engine.

**Audit page** (admin, auditor)
- Filterable list of all audit events.
- "Verify integrity" button that runs `verifyChain()` and shows OK, or the first broken entry.

## 8. Seed data

- Users (dev-only password from `.env`, see `.env.example`):
  - alice@example.com — analyst
  - bob@example.com — analyst
  - carol@example.com — approver
  - dan@example.com — admin
  - erin@example.com — auditor
- ~30 KYC cases with obviously fake data (use a fixed faker seed), varied risk scores and flags, mixed statuses, split between alice and bob, some unassigned.

## 9. Contract (must match exactly — independent tests are written against it)

**API routes** (all JSON; all except login require a session cookie)

| Method & path | Body | Notes |
|---|---|---|
| `POST /api/auth/login` | `{ email, password }` | 200 + session cookie, or 401 |
| `POST /api/auth/logout` | — | clears session |
| `GET /api/kyc/cases` | — | cases visible to caller, PII masked |
| `GET /api/kyc/cases/:id` | — | detail, PII masked; 404 if not visible to caller |
| `POST /api/kyc/cases/:id/assign` | `{ analystId }` | admin |
| `POST /api/kyc/cases/:id/start-review` | — | assigned analyst |
| `POST /api/kyc/cases/:id/recommend` | `{ recommendation: "approve" \| "reject", note }` | assigned analyst; creates ApprovalRequest |
| `POST /api/kyc/cases/:id/reveal` | `{ field: "dateOfBirth" \| "nationalId" \| "address", reason }` | returns `{ value }` for that one field |
| `GET /api/approvals?status=PENDING` | — | approver |
| `POST /api/approvals/:id/decide` | `{ decision: "confirm" \| "return", note }` | approver, never the requester |
| `GET /api/audit` | query filters optional | admin, auditor |
| `GET /api/audit/verify` | — | `{ ok: true }` or `{ ok: false, brokenEventId }` |

Status codes: 401 unauthenticated, 403 lacks permission, 404 record not visible to caller (S7), 400 invalid input.

**Platform functions** (exported with these names from `src/platform`)
- `createApprovalRequest(tx, { entityType, entityId, action, payload, requestedById, requestNote })`
- `decideApproval({ requestId, deciderId, decision, note })` — throws `ForbiddenError` if `deciderId` equals the requester
- `verifyChain(): Promise<{ ok: true } | { ok: false; brokenEventId: string }>`
- `writeAuditEvent(tx, event)`

**Test environment**
- `npm run test:security` resets and seeds a separate database (`DATABASE_URL=file:./test.db`), starts the app on port 3100 using Playwright's `webServer` config, and runs everything in `tests/security`.
- Seed data is deterministic. Tests discover case IDs through the API (e.g. log in as alice, list her cases, then try one of those IDs as bob).
- Tests may import the platform functions above and use Prisma directly against `test.db` (e.g. to attempt an UPDATE on AuditEvent).

## 10. Definition of done

- From a clean clone: `npm install`, `npm run setup` (migrate + seed), `npm run dev` works.
- `npm test`, `npm run lint`, and `npm run typecheck` all pass. `npm run test:security` is wired up and runs (the security tests themselves are added separately).
- README includes: how to run, a short architecture overview, a **demo walkthrough** that shows each trust control in action (login, record-level access, PII reveal, maker-checker, audit integrity check), and a "Production path" section (see below).
- `docs/ADDING_AN_APP.md` explains, step by step, how to add a new app using only platform building blocks.

## 11. Out of scope (list in README under "Production path")

Real SSO/OIDC, Postgres, cloud deployment, anchoring the latest audit hash outside the database (see S12), encryption at rest with a managed key service, export of audit logs to a SIEM, rate limiting, user-management UI, data retention policies.
