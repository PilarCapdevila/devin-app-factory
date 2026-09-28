# Build log — Disputes (SWE-2 experiment)

- **Session:** https://app.devin.ai/sessions/da38a0c9fed14dd2b443bfafcbcb8aa3
- **Task:** Build a chargeback disputes queue app on the internal tools platform (playbook
  "Build a new internal app"), branch `disputes-swe2`, draft PR "Disputes (SWE-2 experiment)".
  Independent build from `main` only — no other disputes/chargeback branch or PR was consulted.
- **Start:** 2026-09-28 ~17:51 UTC
- **End:** 2026-09-28 ~18:10 UTC (~20 min; plus ~35 min delegated browser testing)

## What was built

- `Dispute` Prisma model + migration `20260928175600_disputes`; deterministic seed (17 disputes,
  every status, both analysts assigned, one unassigned, one live `PENDING` approval request,
  decided `ACCEPTED` + `CONTESTED` history, deadlines spread overdue/soon/later).
- Permissions `disputes.dispute.read|work|decide|assign` added to `ROLE_PERMISSIONS`;
  `disputes.dispute.decide` added to `DECIDE_PERMISSIONS`. PII fields `customerEmail`,
  `customerAddress` added to `PII_FIELD_NAMES`.
- `src/apps/disputes/`: `visibleWhere`, business logic, approval action `disputes.decision`
  (`onConfirm` → `ACCEPTED`/`CONTESTED` per recommendation, `onReturn` → `IN_REVIEW`), zod
  schemas, UI built from `@/platform/ui`; registered in `src/apps/register.ts` and `links.ts`.
- Routes `GET/POST /api/disputes*` (all `secureHandler` with declared permissions; reveal route
  is `revealsPii`), pages `/disputes` + `/disputes/[id]`, nav entry.
- `tests/unit/disputes.test.ts` per `docs/ADDING_AN_APP.md` §8; matrix tests updated.

## Decisions made without asking (product decisions)

- Final statuses `ACCEPTED` / `CONTESTED` (domain vocabulary) instead of `APPROVED`/`REJECTED`;
  returned disputes go back to `IN_REVIEW`.
- "Fight it" = recommend `contest` — the note carries the rationale; no evidence-upload feature.
- Deadline modelled as `responseDeadline`; queue sorts nearest-first and flags overdue.
- `customerName` not PII (mirrors `applicantName` in KYC — needed to identify queue rows).
- Amount stored as integer minor units + currency; reason codes as short strings.
- Routes live at `/api/disputes` (entity name equals app name).
- Approval plan change requested by the user was applied: **no full card number stored** —
  only `cardLast4` (non-PII), keeping the app out of PCI DSS scope. `cardNumber` was dropped
  from the model, seed, `PII_FIELD_NAMES` and the planned `maskValue` suffix rule.

## User messages that corrected or clarified the work

1. "Approved with one change. Do not store full card numbers: drop cardNumber from the model,
   seed, PII_FIELD_NAMES and the maskValue rule, and store only cardLast4 (not PII)…"
   → Applied as described above.

## Test results

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 51/51 unit tests pass (8 files, incl. new `disputes.test.ts`).
- `npm run build`: clean (all `/disputes` pages + `/api/disputes*` routes listed).
- `npm run test:security`: `tests/security/playwright.config.ts does not exist` — expected
  until the independent security suite lands on `main`.
- Browser walkthrough per role (alice, bob, carol, dan, erin): all 10 checks passed — scoped
  queues and 404 outside scope, masked PII + reasoned reveal, maker step, maker cannot decide,
  confirm/return in `/approvals`, audit log entries (`pii.reveal`, `access.denied`,
  `approval.confirmed`, `disputes.dispute.*`), wrong-password handling, logout,
  unauthenticated redirect/401. Evidence (recording + screenshots) posted on the PR.

ACUs used: (to be added)
