# Internal tools platform + KYC Review Queue + Dispute Queue
# Internal tools platform + KYC Review Queue + Refunds Dashboard

A prototype of a secure internal-tools platform (the "app factory") and its apps: a KYC Review
Queue and a Dispute Queue (card chargebacks). The platform owns authentication, authorization, record-level access, PII masking, auditing
and maker-checker approvals; apps contain business logic only. `SPEC.md` is the product/architecture
spec and `SECURITY.md` lists the non-negotiable controls (M1–M10, H1–H8).

## How to run

Requirements: Node 20+ (Node 24 used for development), npm.

```bash
npm install          # also generates the Prisma client
npm run setup        # creates .env (random SESSION_SECRET) if missing, migrates and seeds dev.db
npm run dev          # http://localhost:3000
```

Sign in with any seeded user (password `password123`, or `SEED_PASSWORD` from `.env`):

| User                | Role     | Can                                                                  |
| ------------------- | -------- | -------------------------------------------------------------------- |
| `alice@example.com` | analyst  | see and work **her own** cases, reveal PII with a reason             |
| `bob@example.com`   | analyst  | same, for his cases                                                  |
| `carol@example.com` | approver | see all cases, decide approval requests, reveal PII; see all refunds and confirm/return refund requests |
| `dan@example.com`   | admin    | see all cases, assign cases, read the audit log (no PII reveal); see all refunds (read-only, cannot decide) |
| `erin@example.com`  | auditor  | see all cases (masked), read the audit log; see all refunds (masked, read-only) |
| `frank@example.com` | support_agent | see all refunds and create refund requests (no KYC access, no PII reveal) |

The same users and roles carry over to the Dispute Queue (`/disputes`): analysts work **their own**
disputes and propose accept/fight, the approver signs every proposal off, the admin assigns disputes,
the auditor reads everything masked. Permissions are `disputes.dispute.read|work|decide|assign`; see
[Dispute Queue](#dispute-queue) below.

Other commands:

```bash
npm test               # unit tests (Vitest, fresh unit-test.db)
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm run test:security  # Playwright, config tests/security/playwright.config.ts (test.db, port 3100)
npm run db:reset       # delete + migrate + reseed the database at DATABASE_URL (e.g. DATABASE_URL=file:./test.db)
npm run build          # production build
```

`npm run test:security` runs Playwright with `tests/security/playwright.config.ts`. That directory —
config and tests — is delivered by the independent security suite and is intentionally absent here,
so the command exits with "tests/security/playwright.config.ts does not exist" until the suite is merged. The suite's config is
expected to reset and seed `test.db` (`DATABASE_URL=file:./test.db npm run db:reset`) and start the
app on port 3100 through Playwright's `webServer`. Stop any other `next dev` in this directory first —
Next.js allows one dev server per project.

## Design in one picture

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

Security lives in four checkpoints: `secureHandler`, scoped queries (`visibleWhere`), the approvals
engine, and database triggers. If a future app forgets something the defaults still protect it:
a route without a declared permission fails closed (403), and PII is masked by default.

### Repository layout

```
src/platform/      auth, session, permissions, handler, audit, approvals, pii, db + ui/ components
src/apps/kyc/      KYC app: visibleWhere, cases (workflow), approval action, schemas, ui/
src/apps/disputes/ Dispute Queue app: visibleWhere, disputes (workflow + deadline flags), approval action, schemas, ui/
src/apps/refunds/  Refunds app: visibleWhere, refunds (maker step, filters, summary), approval action, schemas, ui/
src/connectors/    external systems (payments.ts: PaymentsConnector interface + mock recording MockPaymentCall rows)
src/apps/          register.ts (app registrations loaded at server start), links.ts (entity → page)
src/app/           Next.js routes: pages (login, kyc, disputes, approvals, audit) and api/ (section 11 contract + api/disputes)
src/app/           Next.js routes: pages (login, kyc, refunds, approvals, audit) and api/ (section 11 contract)
src/proxy.ts       unauthenticated → 401 (API) / redirect to /login (pages)
prisma/            schema, migration (incl. append-only triggers), deterministic seed
tests/unit/        Vitest unit tests for platform + KYC + disputes logic
tests/unit/        Vitest unit tests for platform + KYC + Refunds logic
tests/security/    reserved for independent security tests (Playwright, API mode)
docs/              ADDING_AN_APP.md, build-log/
```

## Demo walkthrough

Every step below can be done in the browser; the equivalent API call is shown so it can be scripted
(`curl -c jar -b jar` keeps the session cookie).

### 1. Login (M1, H1, H2)

Open http://localhost:3000 — you are redirected to `/login`. Sign in as `alice@example.com`.
Wrong credentials return the generic "Invalid email or password". The session is an encrypted,
httpOnly iron-session cookie (`its_session`, 8 h TTL, `secure` in production); the server refuses to
start without a `SESSION_SECRET` of at least 32 characters.

```bash
curl -c jar -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"password123"}'      # 200 {"user":{...}}
curl localhost:3000/api/kyc/cases                                   # 401 without a session
```

### 2. Record-level access (M2, M3, M4)

Alice's queue at `/kyc` shows only cases assigned to her. Copy a case id from Bob's queue (log in as
Bob in another browser) and open `/kyc/<that id>` as Alice: **404**, not 403 — she cannot learn that
the case exists. The denial is written to the audit log as `access.denied`. Alice also gets 403 on
`/audit` and on `GET /api/kyc/analysts` (permission `kyc.case.assign`), and those denials are audited
too. Roles are looked up from the database on every request; nothing about the role is trusted from
the client. Every permission is declared on the route in `secureHandler({ permission })` — see
`src/platform/permissions.ts` for the exact matrix.

```bash
curl -b jar localhost:3000/api/kyc/cases/<bobs-case-id>   # 404
curl -b jar localhost:3000/api/audit                      # 403
```

### 3. PII masking and reveal (M10)

Open one of Alice's cases. Date of birth, national ID and address are masked (`••••••`, national ID
keeps its last 4 characters) — the API response is masked recursively, so no route can leak them by
accident. Click **Reveal** next to a field: a reason of at least 10 characters is required; the value
is returned only for that field and a `pii.reveal` audit event records who, which field, which record
and why. Dan (admin) has no `pii.reveal` permission and gets 403.

```bash
curl -b jar -X POST localhost:3000/api/kyc/cases/<id>/reveal -H 'content-type: application/json' \
  -d '{"field":"nationalId","reason":"Verifying identity document against application"}'
# 200 {"field":"nationalId","value":"..."}      reason shorter than 10 chars → 400
```

### 4. Maker-checker in the approvals inbox (M5, M6, M7)

As Alice, on a `NEW` case click **Start review**, then **Recommend approve** (or reject) with a note.
The case becomes `PENDING_APPROVAL`; Alice cannot decide it herself — the approvals inbox at
`/approvals` is not even in her navigation and `/api/approvals` returns 403. Log in as
`carol@example.com` (approver) and open **Approvals**: the request shows the requester, the
recommendation and the note. Choose **Confirm** or **Return** — a decision note is mandatory. On
confirm the case becomes `APPROVED`/`REJECTED`; on return it goes back to `IN_REVIEW`. The final
status is changed only inside the approval engine's registered `kyc.decision` callback: there is no
route that sets it directly. Trying to decide a request twice is rejected (a request has exactly one
decider), and if the requester and decider were the same user the engine returns 403 even for an
approver.

```bash
curl -b jar -X POST localhost:3000/api/kyc/cases/<id>/start-review
curl -b jar -X POST localhost:3000/api/kyc/cases/<id>/recommend -H 'content-type: application/json' \
  -d '{"recommendation":"approve","note":"Documents verified, low risk"}'
# as carol:
curl -b carol -X POST localhost:3000/api/approvals/<requestId>/decide -H 'content-type: application/json' \
  -d '{"decision":"confirm","note":"Agree with analyst assessment"}'
```

### 5. Audit log and append-only protection (M8, M9)

Log in as `dan@example.com` or `erin@example.com` and open **Audit**. Filter by actor, action, entity
type or entity id — you will find `auth.login`, `kyc.case.review_started`, `kyc.case.recommended`,
`approval.requested`, `approval.confirmed`, `kyc.case.approved`, `pii.reveal` and `access.denied`
events with actor, role, timestamp, before/after snapshots and reason. Every state change writes its
audit event in the same database transaction as the change. The case detail page shows the same
trail for that case.

The `AuditEvent` table has database triggers that reject `UPDATE` and `DELETE`:

```bash
npx prisma db execute --stdin <<< "DELETE FROM \"AuditEvent\";"
# Error: ... AuditEvent is append-only: DELETE rejected
```

(`tests/unit/audit.test.ts` asserts this through both Prisma and raw SQL.)

## Dispute Queue

The second app on the platform: when a customer disputes a card payment with their bank we receive a
chargeback with a response deadline. Analysts work the disputes assigned to them, review payment and
customer details and propose either **accepting** the dispute (we lose the money) or **fighting** it
(we submit evidence); every proposal needs the approver's sign-off. It reuses every platform control
above — the only app-specific code is the data model, the workflow and the pages.

**No full card numbers are stored.** The `Dispute` record keeps only `cardLast4` (four digits, not
PII, shown in clear as `•••• 1234`); the PII fields are `cardholderName` and `customerEmail`, masked
by default and revealed only with a reason (`pii.reveal`, audited). Full PANs would put the system in
PCI DSS scope and the queue only ever needs the last four.

Status flow: `NEW → IN_REVIEW → PENDING_APPROVAL → ACCEPTED | CHALLENGED` (return sends the dispute
back to `IN_REVIEW`, keeping the proposal and evidence summary for revision). `ACCEPTED` = chargeback
accepted, `CHALLENGED` = fight approved. Final statuses are set only inside the registered
`disputes.decision` approval action. A `fight` proposal requires an evidence summary (20–4000
characters); `accept` does not.

Deadlines: every dispute has a `respondBy` timestamp. The queue is sorted by deadline (soonest first)
and flags each open dispute as **Overdue** (deadline passed), **Due soon** (within 72 h) or **On
track**; closed disputes show **Closed**. The flag is derived at read time and can be filtered
(`?due=overdue|due_soon|on_track`). Overdue disputes can still be worked and decided — there is no
automatic expiry.

| Role     | Disputes permissions                                | In the browser                                                                   |
| -------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| analyst  | `disputes.dispute.read`, `disputes.dispute.work`    | own disputes only (404 otherwise); start review, propose accept/fight; reveal PII |
| approver | `disputes.dispute.read`, `disputes.dispute.decide`  | all disputes; confirm/return proposals in **Approvals**; reveal PII               |
| admin    | `disputes.dispute.read`, `disputes.dispute.assign`  | all disputes; assign `NEW`/`IN_REVIEW` disputes to analysts; no reveal, no decide |
| auditor  | `disputes.dispute.read`                             | all disputes (masked), audit log; no actions                                     |

API (every route is one `secureHandler` call; PII masked except on `reveal`):

| Method | Path                               | Permission                | Notes                                                                    |
| ------ | ---------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/disputes?status=&due=`       | `disputes.dispute.read`   | scoped by `visibleWhere`, sorted by `respondBy`, `dueState` per row      |
| GET    | `/api/disputes/:id`                | `disputes.dispute.read`   | 404 outside scope; includes audit trail and approval requests            |
| GET    | `/api/disputes/analysts`           | `disputes.dispute.assign` | analysts a dispute can be assigned to                                    |
| POST   | `/api/disputes/:id/assign`         | `disputes.dispute.assign` | `{ analystId }`, `NEW`/`IN_REVIEW` only                                  |
| POST   | `/api/disputes/:id/start-review`   | `disputes.dispute.work`   | `NEW → IN_REVIEW`                                                        |
| POST   | `/api/disputes/:id/propose`        | `disputes.dispute.work`   | `{ proposal: "accept"\|"fight", note, evidenceSummary? }` → `PENDING_APPROVAL` + approval request, one transaction |
| POST   | `/api/disputes/:id/reveal`         | `pii.reveal`              | `{ field: "cardholderName"\|"customerEmail", reason ≥ 10 chars }`, audited `pii.reveal` |
| POST   | `/api/approvals/:id/decide`        | `disputes.dispute.decide` | shared inbox route; `confirm` → `ACCEPTED`/`CHALLENGED`, `return` → `IN_REVIEW` |

Audit actions: `disputes.dispute.assigned`, `.review_started`, `.proposed`, `.accepted`,
`.challenged`, `.returned`, plus the platform's `approval.requested/confirmed/returned`,
`pii.reveal` and `access.denied`.

### Dispute Queue walkthrough

1. **Login** as `alice@example.com` and open **Disputes**. The queue lists only her disputes, soonest
   deadline first, with the Overdue / Due soon / On track badge and the time remaining. Cardholder
   name and customer email are masked; the card shows only `•••• 1234`.
2. **Record-level access**: open a dispute from Bob's queue (log in as Bob elsewhere) as Alice at
   `/disputes/<id>` → "Not found" (404, never 403); the denial is audited as `access.denied`.
3. **PII reveal**: on one of Alice's disputes click **Reveal** next to the cardholder name or
   customer email. A reason shorter than 10 characters is rejected; a valid reason returns the value
   and writes `pii.reveal`. Dan (admin) and Erin (auditor) have no reveal button and get 403 on the
   API.
4. **Maker step**: on a `NEW` dispute click **Start review**, then either **Propose accept** with a
   note, or fill in the evidence summary and click **Propose fight**. Proposing fight without an
   evidence summary is rejected. The dispute becomes `PENDING_APPROVAL` and an approval request is
   created; Alice cannot decide it (no Approvals entry, `/api/approvals` → 403).
5. **Checker**: log in as `carol@example.com`, open **Approvals** — the request links back to the
   dispute and shows the proposal, note and evidence summary. **Confirm** sets `ACCEPTED` (accept)
   or `CHALLENGED` (fight); **Return** sends it back to `IN_REVIEW`. A decision note is mandatory
   and a request can be decided once.
6. **Admin**: as `dan@example.com`, assign an unassigned `NEW` dispute to an analyst; the Decide
   and Reveal controls are absent and the corresponding API calls return 403.
7. **Audit**: as Dan or Erin open **Audit log** and filter by entity type `disputes.dispute` to see
   the trail, including `pii.reveal`, `access.denied`, `approval.confirmed` and
   `disputes.dispute.accepted` / `.challenged`. Then **Log out**.

```bash
curl -b jar "localhost:3000/api/disputes?due=due_soon"                      # alice: own disputes due within 72 h
curl -b jar -X POST localhost:3000/api/disputes/<id>/start-review
curl -b jar -X POST localhost:3000/api/disputes/<id>/propose -H 'content-type: application/json' \
  -d '{"proposal":"fight","note":"Delivery confirmed","evidenceSummary":"Signed delivery confirmation and matching device fingerprint."}'
curl -b jar -X POST localhost:3000/api/disputes/<id>/reveal -H 'content-type: application/json' \
  -d '{"field":"customerEmail","reason":"Customer called about this chargeback"}'
# as carol:
curl -b carol -X POST localhost:3000/api/approvals/<requestId>/decide -H 'content-type: application/json' \
  -d '{"decision":"confirm","note":"Evidence is sufficient to challenge"}'
```

### 6. Refunds Dashboard (second app on the platform)

Support agents request refunds on customer payments; an approver confirms or returns each request;
only a confirmation issues the refund, through the payments connector in `src/connectors/payments.ts`
(mock implementation that records every call in the `MockPaymentCall` table). Refund status is
`PENDING_APPROVAL → ISSUED | RETURNED`; a returned refund is final and the agent may request again for
the same payment.

| Method | Path | Permission | Who |
| --- | --- | --- | --- |
| `GET` | `/api/refunds?status&minAmountCents&maxAmountCents` | `refunds.refund.read` | support_agent, approver, admin, auditor |
| `GET` | `/api/refunds/summary` | `refunds.refund.read` | tiles: pending count/total, issued-today count/total (UTC day) |
| `GET` | `/api/refunds/:id` | `refunds.refund.read` | refund + approval requests + audit trail |
| `POST` | `/api/refunds` | `refunds.refund.request` | support_agent only — the maker step |
| `POST` | `/api/refunds/:id/reveal` | `pii.reveal` (`revealsPii`) | approver (support_agent has no `pii.reveal`) |
| `POST` | `/api/approvals/:id/decide` | `refunds.refund.decide` (via the shared inbox route) | approver only |

1. **Login and scope.** Sign in as `frank@example.com` — you land on `/refunds` (Frank has no KYC
   permission; the root and login redirects follow the permission matrix). The dashboard shows the
   summary tiles, status / min / max amount filters and every refund (`visibleWhere` is `{}` for all
   refund readers; scope is still applied to every query). Open a refund: the customer email is
   masked (`••••••`); `cardLast4` is shown as it is already a last-4 value. Frank sees no **Reveal**
   button; `POST /api/refunds/<id>/reveal` as Frank → 403, audited as `access.denied`. A made-up id
   at `/refunds/<id>` → **Not found**.
2. **Maker step.** As Frank click **New refund request**, fill payment id, customer, card last 4,
   amount and reason, then **Submit for approval**. The refund appears as `PENDING_APPROVAL` with a
   `refunds.refund.requested` event; the `ApprovalRequest` (action `refunds.issue`) is created in the
   same transaction. Frank cannot decide it: he has no approvals inbox and `/api/approvals/<id>/decide`
   returns 403 for the requester even if he had the permission (M5). A second request for the same
   payment while one is pending → 400.
3. **Checker step.** Sign in as `carol@example.com`, open **Approvals** (or the refund page): the
   request links to `/refunds/<id>`, where **Reveal** on the email requires a reason of 10+ characters
   (`pii.reveal` audit event). **Confirm and issue refund** (note required) runs the `refunds.issue`
   `onConfirm`: the connector is called with the approval request id as idempotency key, a
   `MockPaymentCall` row is written, the refund becomes `ISSUED` and `refunds.refund.issued` +
   `approval.confirmed` are audited — all in one transaction. **Return to support** makes it
   `RETURNED` (`refunds.refund.returned`, no connector call). No route sets these statuses directly.
4. **Read-only roles.** `dan@example.com` (admin) and `erin@example.com` (auditor) see the dashboard
   and detail pages but no request form and no decide bar; `POST /api/refunds` and the decide route
   return 403 (`access.denied` in the audit log). Dan cannot decide refunds — `refunds.refund.decide`
   belongs to approvers only. Analysts (`alice`, `bob`) have no refunds permission at all: 403.
5. **Audit.** In **Audit log** filter `entityType = refunds.refund` to see `refunds.refund.requested`,
   `refunds.refund.issued`, `refunds.refund.returned` and `pii.reveal`, plus `approval.requested` /
   `approval.confirmed` / `approval.returned` on the request and `access.denied` on denied routes.

```bash
# as frank:
curl -b frank -X POST localhost:3000/api/refunds -H 'content-type: application/json' \
  -d '{"paymentId":"pay_123","customerName":"Jane Doe","customerEmail":"jane@example.com","cardLast4":"4242","amountCents":4999,"currency":"USD","reason":"Duplicate charge"}'
curl -b frank "localhost:3000/api/refunds?status=PENDING_APPROVAL&minAmountCents=1000"   # customerEmail masked
# as carol:
curl -b carol -X POST localhost:3000/api/approvals/<requestId>/decide -H 'content-type: application/json' \
  -d '{"decision":"confirm","note":"Verified with the customer"}'           # refund ISSUED, MockPaymentCall written
```

## Production path

This is a prototype. Before production the following, deliberately out of scope here (SPEC.md §14),
would be added:

- Real SSO/OIDC instead of email + bcrypt password login (the session layer stays as is)
- Postgres instead of SQLite (the Prisma schema and the append-only triggers port directly)
- Cloud deployment and deployment CI/CD (only a test CI workflow is included)
- Tamper-evident hash chain on the audit log
- Encryption at rest with a managed key service
- Audit export to a SIEM
- Rate limiting (login and reveal endpoints in particular)
- User-management UI (users are seeded only)
- Data retention policies
- Multi-step approvals (the engine supports exactly one decider per request)
- A real payments provider behind `PaymentsConnector` (only the mock, which records calls in `MockPaymentCall`, exists)

Also recommended: `secure` cookies are already enabled in production builds; put the app behind TLS,
set `SESSION_SECRET` from a secret manager, and rotate the seed password out of `.env`.

## Adding an app

See [`docs/ADDING_AN_APP.md`](docs/ADDING_AN_APP.md). Build notes are in `docs/build-log/`.
