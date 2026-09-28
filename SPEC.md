# Internal Tools Platform — Prototype Spec

## 1. Purpose

This prototype answers one question for a fintech operations team: **can a small engineering team build and maintain many internal tools with security equal to a commercial platform like Microsoft Power Apps?**

It must produce evidence for three claims:
1. **Security is inherited, not rebuilt.** Every app gets authentication, permissions, record-level access, PII protection, audit, and approvals from the platform, and cannot bypass them.
2. **New apps are cheap.** An app contains only its business logic; everything else comes from the platform.
3. **Changes are cheap and safe.** The code is simple, tested, and easy to modify.

This repo contains:
- **The platform** (`src/platform`): shared security, workflow, and UI building blocks.
- **One reference app** (`src/apps/kyc`): a KYC Review Queue built only from platform building blocks.

## 2. Design in one picture

```
Browser ──► API route ──► secureHandler ──────────────────────────────────────► Response
                          1. Authenticate (session)         → 401 if missing
                          2. Authorize (declared permission) → 403 if not allowed
                          3. Run app logic
                             • reads go through the app's visibleWhere(user) → 404 outside scope
                             • writes run in a transaction with writeAuditEvent()
                             • final outcomes only via the approvals engine
                          4. Mask every PII field in the response
                             (unless the route is declared revealsPii)
                          + Any denial for a logged-in user is audited

Database: AuditEvent table is append-only (triggers reject UPDATE/DELETE)
```

**Security lives in four checkpoints: `secureHandler`, scoped queries, the approvals engine, and database triggers.** Apps contain business logic only. If a future app forgets something, the platform's defaults still protect it: missing permission fails closed, and PII is masked by default.

## 3. What this replicates from Power Apps

| Power Apps / Power Platform | This platform |
|---|---|
| Microsoft Entra ID sign-in | `auth.ts` (mock login now, SSO-ready interface) |
| Dataverse security roles | `permissions.ts` (role → permission map) |
| Dataverse row-level security | each app's `visibleWhere(user)`; out-of-scope records return 404 |
| Dataverse column-level security | automatic PII masking in `secureHandler` + reveal-with-reason |
| Dataverse auditing | `audit.ts` + append-only database triggers |
| Power Automate approvals | `approvals.ts` + one approvals inbox across all apps |
| Canvas app components | `src/platform/ui` |
| Connectors | `src/connectors` (interface + mock implementation per external system) |
| Solutions / ALM | Git, pull requests, automated tests |

## 4. Rules for all code

- **SECURITY.md overrides this document.** If anything conflicts, follow SECURITY.md.
- **Build only what this spec lists.** Do not implement stretch items or extra features. In particular: the approvals engine records one confirmation per approver and an action may require more than one (`requiredApprovals`, default 1, currently used only by refunds over $2,000.00); there is no other workflow logic (no delegation, escalation or sequencing), no audit hash chain and no SSO/OIDC.
- Server-side enforcement only; hiding things in the UI is cosmetic.
- Simple, readable code. A reviewer new to the codebase should understand the platform in 15 minutes.
- External systems are reached only through `src/connectors/*` (none are needed for KYC).

## 5. Stack

- Next.js (latest stable, App Router), TypeScript strict mode
- SQLite via Prisma (a local file; no database server)
- Tailwind CSS
- zod for input validation
- Vitest for unit tests; Playwright (API testing mode) for security tests
- Encrypted httpOnly session cookie (e.g. iron-session)

## 6. Structure

```
src/
  platform/
    auth.ts          login, logout, getCurrentUser()
    permissions.ts   role → permission map as plain data; can()
    handler.ts       secureHandler() and error types
    audit.ts         writeAuditEvent()
    approvals.ts     registerApprovalAction(), createApprovalRequest(), decideApproval()
    pii.ts           PII_FIELD_NAMES, maskValue(), revealField()
    db.ts            Prisma client, withTransaction()
    ui/              AppShell, DataTable, DetailPanel, MaskedField, ApprovalBar, AuditTrail
  apps/
    kyc/             KYC Review Queue: visibleWhere(), routes' logic, pages' components,
                     approval action registration
  connectors/        (empty for now; convention: interface + mock per external system)
  app/               Next.js pages and API routes — thin, delegate to src/platform and src/apps
prisma/
  schema.prisma
  migrations/        includes raw SQL triggers making AuditEvent append-only
  seed.ts
tests/
  unit/              tests written during the build
  security/          RESERVED for independent security tests. Do not create or edit files here.
docs/
  ADDING_AN_APP.md   step-by-step guide to building a new app on the platform
  build-log/         one short report file per Devin session (see section 13)
.github/workflows/
  ci.yml             lint, typecheck, unit tests and security tests on every PR
```

## 7. Platform modules

**`handler.ts` — `secureHandler(options, fn)`**
- Options: `permission` (required string), `revealsPii` (boolean, default false), `input` (optional zod schema).
- Steps: authenticate → check permission → validate input → run `fn` → mask PII in the JSON response (unless `revealsPii`) → return.
- A handler declared without `permission` must fail closed (return 403 for every call).
- Exports error types that any code can throw: `ValidationError` (400), `ForbiddenError` (403), `NotFoundError` (404). The handler converts them to generic responses. For a logged-in user, 403 and 404 are audited as `access.denied`.

**`permissions.ts`** — the role → permission map from section 8 as a single plain object, plus `can(user, permission)`.

**`audit.ts` — `writeAuditEvent(tx, event)`** — writes an AuditEvent inside the caller's transaction. Every state-changing operation calls it in the same transaction as the change.

**`approvals.ts`** — the only path to final outcomes.
- `registerApprovalAction(action, { decidePermission, requiredApprovals?(request), onConfirm(tx, request), onReturn(tx, request) })` — each app registers what happens when its request is confirmed or returned. `requiredApprovals` is optional and defaults to 1; it is evaluated per request at decision time (from the stored payload), so a changed rule applies to requests that are already pending.
- `createApprovalRequest(tx, { entityType, entityId, action, payload, requestedById, requestNote })`
- `decideApproval({ requestId, deciderId, decision: "confirm" | "return", note })` — in one transaction: checks the request is `PENDING`, the decider is **not** the requester and has **not** already confirmed this request, the decider has the action's `decidePermission`, and a note is present. `confirm` records an `ApprovalConfirmation` for the decider; while fewer than `requiredApprovals` different approvers have confirmed, the request stays `PENDING`, `onConfirm` is not called and `approval.step_confirmed` is audited. The confirmation that reaches `requiredApprovals` (or any `return`, at any step) updates the request (`decidedById` = that approver), calls `onConfirm` or `onReturn` and writes `approval.confirmed` / `approval.returned`. Throws `ForbiddenError` or `ValidationError` otherwise. With the default of 1 this is the single-decision flow KYC and Disputes use.
- `requiredApprovalsFor(request)` — the count an app's UI needs to show progress ("1 of 2 approvals").

**`pii.ts`**
- `PII_FIELD_NAMES`: the global list of sensitive field names (`dateOfBirth`, `nationalId`, `address`). Future apps add their fields here.
- `maskValue(field, value)`: `nationalId` shows only the last 4 characters; other fields show `••••••`.
- `revealField({ user, entityType, entityId, field, reason })`: checks `pii.reveal` permission, record access, and reason length; writes an audit event; returns the single value.

**Platform pages** (available to every app automatically)
- `/approvals` — inbox of pending requests the current user may decide, across all apps: never their own, and not the ones they have already confirmed. Requests needing more than one approval show their progress ("1 of 2 approvals") and who has confirmed.
- `/audit` — filterable audit log (admin, auditor).

## 8. Roles and permissions

Roles: `analyst`, `approver`, `admin`, `auditor`.

| Permission | analyst | approver | admin | auditor |
|---|---|---|---|---|
| `kyc.case.read` | assigned cases only | all | all | all |
| `kyc.case.work` (start review, recommend) | assigned cases only | — | — | — |
| `kyc.case.decide` (confirm or return a recommendation) | — | ✓ | — | — |
| `kyc.case.assign` | — | — | ✓ | — |
| `pii.reveal` | assigned cases only | ✓ | — | — |
| `audit.read` | — | — | ✓ | ✓ |

Deliberate separation of duties: **admin assigns work but cannot decide or reveal PII. Auditor is read-only.**

"Assigned cases only" is enforced by the KYC app's `visibleWhere(user)`, which every KYC query uses.

## 9. Data model

- **User**: id, email, name, role, passwordHash
- **KycCase**: id, applicantName, dateOfBirth, nationalId, address, riskScore (0–100), riskFlags (list), status, assignedToId, createdAt, updatedAt
  - Status flow: `NEW → IN_REVIEW → PENDING_APPROVAL → APPROVED | REJECTED`; a returned case goes `PENDING_APPROVAL → IN_REVIEW`.
- **ApprovalRequest** (generic): id, entityType, entityId, action, payload (JSON), requestedById, requestedAt, requestNote, status (`PENDING | CONFIRMED | RETURNED`), decidedById, decidedAt, decisionNote. `decidedById` is the approver whose confirmation completed the request (or who returned it).
- **ApprovalConfirmation** (generic): id, requestId, approverId, confirmedAt, note; unique per (requestId, approverId). One row per approver who confirmed, including the final one.
- **AuditEvent**: id, timestamp (server time), actorId, actorRole, action, entityType, entityId, before (JSON), after (JSON), reason

## 10. KYC Review Queue

**Queue page** — cases visible to the user; filter by status and risk; sorted by risk score (highest first); PII masked.

**Case detail page** — applicant details with PII masked and a "Reveal" button per field (asks for a reason; shows the value only in that view); risk score and flags; audit trail for the case; action bar showing only the actions the user may take.

**Workflow**
1. Admin assigns a `NEW` case to an analyst.
2. Analyst clicks "Start review" → `IN_REVIEW`.
3. Analyst submits a recommendation (`approve` or `reject`) with a note → creates an ApprovalRequest (action `kyc.decision`, payload `{ recommendation }`) → `PENDING_APPROVAL`.
4. An approver confirms (case becomes `APPROVED` or `REJECTED` per the recommendation) or returns it with a note (case goes back to `IN_REVIEW`). This logic lives in the KYC app's registered `onConfirm` / `onReturn`.

## 11. API contract (must match exactly; independent tests are written against it)

All routes are JSON. All except login require a session cookie.

| Method & path | Body | Permission / notes |
|---|---|---|
| `POST /api/auth/login` | `{ email, password }` | 200 + session cookie, or 401 |
| `POST /api/auth/logout` | — | clears session |
| `GET /api/kyc/cases` | — | `kyc.case.read`; scoped; PII masked |
| `GET /api/kyc/cases/:id` | — | `kyc.case.read`; 404 outside scope |
| `POST /api/kyc/cases/:id/assign` | `{ analystId }` | `kyc.case.assign` |
| `POST /api/kyc/cases/:id/start-review` | — | `kyc.case.work` |
| `POST /api/kyc/cases/:id/recommend` | `{ recommendation: "approve" \| "reject", note }` | `kyc.case.work` |
| `POST /api/kyc/cases/:id/reveal` | `{ field: "dateOfBirth" \| "nationalId" \| "address", reason }` | `pii.reveal`, `revealsPii`; returns `{ field, value }` |
| `GET /api/approvals` | — | pending requests the caller may decide |
| `POST /api/approvals/:id/decide` | `{ decision: "confirm" \| "return", note }` | the action's `decidePermission` |
| `GET /api/audit` | optional query filters | `audit.read` |

Status codes: 400 invalid input, 401 unauthenticated, 403 not permitted, 404 not found or outside scope.

**Test environment:** `npm run test:security` resets and seeds a separate database (`DATABASE_URL=file:./test.db`), starts the app on port 3100 via Playwright's `webServer` config, and runs `tests/security`. Seed data is deterministic. Tests may import platform functions and use Prisma directly against `test.db`.

## 12. Seed data

- Users (dev-only password from `.env`; see `.env.example`): alice@example.com and bob@example.com (analyst), carol@example.com and grace@example.com (approver), dan@example.com (admin), erin@example.com (auditor), frank@example.com (support_agent).
- ~30 KYC cases with obviously fake data (fixed faker seed): varied risk scores and flags, split between alice and bob, a few unassigned, and at least one `PENDING_APPROVAL` case recommended by alice so the approvals inbox is not empty.

## 13. Definition of done

- From a clean clone: `npm install`, `npm run setup` (migrate + seed), `npm run dev` works.
- `npm test`, `npm run lint`, `npm run typecheck` pass. `npm run test:security` is wired up and runs.
- README: how to run; the section 2 diagram; a **demo walkthrough** showing each control (login, record-level access, PII masking and reveal, maker-checker in the approvals inbox, audit log and append-only protection); a "Production path" section.
- `docs/ADDING_AN_APP.md`: a precise, step-by-step guide to adding a new app using only platform building blocks (declare permissions, write `visibleWhere`, add PII field names, register approval actions, wrap routes in `secureHandler`, reuse UI components, add unit tests). This document becomes the basis for building every future app.
- `.github/workflows/ci.yml`: runs `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:security` on every pull request.
- `docs/build-log/`: at the end of every Devin session, add a new file named after the session (e.g. `docs/build-log/A-platform-kyc.md`) with: session name, task, start and end time, decisions made without asking, every user message that corrected or clarified the work, and test results. Leave a line `ACUs used: (to be added)`; the human fills it in from the usage dashboard. Never edit another session's file.

## 14. Out of scope (list in README under "Production path")

Real SSO/OIDC, Postgres, cloud deployment and CI, tamper-evident hash chain on the audit log, encryption at rest with a managed key service, audit export to a SIEM, rate limiting, user-management UI, data retention policies, approval workflow features beyond a required number of distinct confirmations (delegation, escalation, ordered approver chains).
