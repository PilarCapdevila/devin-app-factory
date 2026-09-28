# Build log — Refunds: two approvers over $2,000.00 (compliance change)

Session: Devin session "Two-approver refunds" (https://app.devin.ai/sessions/ee752dc7e610420c8090736ba44525a4),
branch `devin/1790625453-two-approver-refunds`.
Task: Compliance change request — refunds over $2,000.00 must be confirmed by two different approvers
before they are issued; refunds of exactly $2,000.00 or less keep the single-approval flow; the rule
applies to requests already pending. Supersedes the "exactly one decider" rule and the "multi-step
approvals" out-of-scope item in SPEC.md and the playbook. KYC, Disputes and every other app must
behave exactly as before.

Start: 2026-09-28 ~19:40 UTC (plan sent and approved before coding). End: 2026-09-28 20:35 UTC (PR opened; browser testing followed).

## Where the change went, and why

The shared approvals engine (`src/platform/approvals.ts`) got one optional knob; the rule itself lives
in the refunds app. The inbox (`listPendingApprovalsFor`), the maker-checker checks (M6) and the
"only `decideApproval` sets outcomes" rule (M7) all live in the engine, so a refunds-only solution
would have had to chain a second `ApprovalRequest` after the first confirm — which breaks "1 of 2"
progress in the inbox, hides the real requester and leaves a `CONFIRMED` request for a refund that
was never issued. KYC and Disputes do not set the knob and keep the same code path, data and audit
events (their unit tests pass unchanged apart from asserting the default).

## What changed

| Area | Files | Notes |
| --- | --- | --- |
| Engine | `src/platform/approvals.ts` | `ApprovalActionHandlers.requiredApprovals?(request): number` (default 1, evaluated per request at decision time so pending requests follow a changed rule). `decideApproval`: new check "approver has not already confirmed this request" (403, so a confirming approver cannot confirm twice nor return later); `confirm` writes one `ApprovalConfirmation`; while `confirmations < required` the request stays `PENDING`, `onConfirm` is not called and `approval.step_confirmed` is audited (before/after carry `approvalsGiven` / `approvalsRequired`); the final confirmation (or any return) updates the request (`decidedById` = that approver), runs `onConfirm`/`onReturn` and audits `approval.confirmed`/`approval.returned` exactly as before. `listPendingApprovalsFor` excludes requests the caller already confirmed and returns `requiredApprovals` + `confirmations` (with approver name/email). New `requiredApprovalsFor(request)` for app UIs. Return type is now `DecidedApproval` (request + `confirmations` + `requiredApprovals`). |
| Data model | `prisma/schema.prisma`, `prisma/migrations/20260928195751_approval_confirmations/migration.sql` | New `ApprovalConfirmation` (id, requestId, approverId, confirmedAt, note; `@@unique([requestId, approverId])`), relations on `ApprovalRequest` and `User`. `ApprovalRequest` and `AuditEvent` columns unchanged. |
| Refunds rule | `src/apps/refunds/types.ts`, `src/apps/refunds/register.ts` | `TWO_APPROVER_THRESHOLD_CENTS = 200_000`, `requiredApprovalsForAmount(amountCents)` (`> 200_000 ? 2 : 1`, strict); `registerApprovalAction("refunds.issue", { requiredApprovals: (request) => requiredApprovalsForAmount(JSON.parse(request.payload).amountCents), … })`. `onConfirm` (the only path to the connector) is unchanged and now runs only once the count is reached. |
| Refunds API | `src/apps/refunds/refunds.ts` | `getRefund` includes each request's `confirmations` (with approver) and `requiredApprovals`. |
| UI | `src/platform/ui/client.ts`, `src/platform/ui/index.ts`, `src/platform/ui/ApprovalsInbox.tsx`, `src/apps/refunds/ui/RefundDetail.tsx` | `approvalProgressLabel()` ("1 of 2 approvals", null for single-approval requests). Inbox shows progress + "confirmed by …" for multi-approver requests. Refund detail: "Approval progress" and "Confirmed by" in the pending panel, `Confirm (more approvals needed)` vs `Confirm and issue refund` label, a note for an approver who already confirmed (no decide bar), and both approvers in the Decision panel. |
| Seed | `prisma/seed-data.ts`, `tests/unit/helpers.ts` | `grace@example.com` (Grace Approver, approver). Issued refunds over $2,000 now carry two confirmations (carol → `approval.step_confirmed`, grace → final, `decidedById` = grace); issued refunds ≤ $2,000 one confirmation by carol; returned refunds unchanged. `grace()` helper for tests. |
| Tests | `tests/unit/refunds.test.ts` (+8), `tests/unit/approvals.test.ts` | Strict boundary ($2,000.00 → 1, $2,000.01 → 2, also via `getRefund`); exactly $2,000.00 issued on first confirm; first confirm keeps PENDING, no connector call, `approval.step_confirmed` with progress, leaves the approver's inbox, stays in grace's with progress; same approver cannot confirm twice or return after confirming, requester/admin/analyst/auditor still 403; second different approver issues once, `decidedById` = second, audit order `step_confirmed` → `confirmed`; return after first confirm → `RETURNED`, no connector call; return before any confirm; seeded histories consistent. KYC test now asserts the default (1 required, no step event). |
| Docs | `SPEC.md`, `README.md`, `docs/ADDING_AN_APP.md`, this file | SPEC §4 rule, §7 `approvals.ts`, platform pages, §9 data model, §12 seed users, §14 out-of-scope reworded. README role table (grace), refunds intro/API table, walkthrough steps 3–6 (single approval, two approvers, audit), curl example, production-path bullet, KYC note. ADDING_AN_APP §7 (`requiredApprovals` example and semantics) and §8 test list. |
| Playbook | "Build a new internal app on the platform" (Devin playbook) | Update prepared via the playbook tool (needs the user's approval in the Devin UI): Advice now describes the optional `requiredApprovals` setting, lists grace and frank among seeded users, and the scope line no longer says "no multi-step approvals". |

Not changed: `tests/security/*` (independent suite), KYC and Disputes apps, `secureHandler`, audit triggers, payments connector.

## Decisions made without asking (listed in the plan; user approved "including your three default decisions")

- An approver who has already confirmed cannot later return the same request (403).
- The intermediate audit action is `approval.step_confirmed`.
- The playbook is updated too (the plan originally proposed not to; the user asked for it).
- Additional small ones: the threshold is read from the request payload (not the Refund row) so it is the amount the approver saw; the final decision's `decidedById`/`decisionNote` belong to the approver who completed the request; the `approval.confirmed`/`approval.returned` payloads for single-approval actions are byte-for-byte what they were (no `confirmations` array added), so KYC/Disputes audit rows do not change shape; seeded pending refunds have no pre-recorded confirmations (the demo walkthrough creates a fresh over-threshold request).

## User messages that corrected or clarified the work

1. "Approved, including your three default decisions. Two additions: (1) also update the playbook … so it no longer says multi-step approvals are out of scope, and mentions the optional requiredApprovals setting; (2) the disputes PR has just been merged into main, so rebase onto the latest main before opening your PR, and confirm disputes still behaves exactly as before."

## Test results

- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm test` — 9 files, 87 tests passed (79 before; +8 refunds tests; disputes and KYC suites unchanged and green).
- `npm run build` — succeeds.
- `npm run test:security` — 175 passed (M1–M10, Playwright against a fresh `test.db`).
- Branch is based on `origin/main` at `7a764cb` (Merge pull request #5 — disputes), verified with `git merge-base --is-ancestor` just before pushing.
- Browser test (testing agent, recorded): see the PR for the result of the two-approver flow, a single-approval refund and the Disputes regression check.

ACUs used: (to be added)
