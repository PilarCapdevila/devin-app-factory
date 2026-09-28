# Security Requirements (non-negotiable)

This document overrides SPEC.md. Every rule has an ID. Tests in `tests/security/` must reference these IDs in their names (e.g. `S7: analyst cannot read a case assigned to someone else`). Every rule must have at least one test.

## Authentication

- **S1.** Every page and server endpoint except `/login` requires an authenticated session. Unauthenticated page requests redirect to `/login`; unauthenticated API/server-action calls return 401.
- **S2.** The session cookie is encrypted, `httpOnly`, `sameSite=lax`, `secure` in production, and expires after 8 hours.
- **S3.** Passwords are hashed with bcrypt or argon2. Passwords and session contents are never logged.
- **S4.** The session secret comes from an environment variable. The app refuses to start if it is missing or shorter than 32 characters.

## Authorization

- **S5.** Deny by default. Every API route is wrapped in `secureHandler` with a declared permission; a handler without one fails closed.
- **S6.** Permissions are checked on the server for every request. The user's role is read from the server-side session, never from client input.
- **S7.** Record-level access: an analyst can only read or act on cases assigned to them. Requesting another analyst's case by ID returns 404 (not 403), so case IDs cannot be probed.
- **S8.** Separation of duties: admin cannot approve decisions or reveal PII. Only the `approver` role can make a final approval decision.

## Audit

- **S9.** Every state change writes an audit event in the **same database transaction**. If the audit write fails, the change is rolled back.
- **S10.** Every PII reveal and every denied access attempt is also audited.
- **S11.** The audit log is append-only: database triggers reject any `UPDATE` or `DELETE` on the AuditEvent table, and no application code path updates or deletes audit events.
- **S12.** Hash chain: each event stores `hash = SHA-256(prevHash + canonical JSON of the event)`. `verifyChain()` detects any modified, inserted, or removed event and reports the first broken entry. (Known limit: removing the most recent events cannot be detected by the chain alone. S11 blocks deletion; the production fix, periodically anchoring the latest hash outside the database, is listed under Production path.)
- **S13.** Each audit event records actor, actor role, action, entity type and ID, before and after state, reason (if any), and server-side timestamp.

## Maker-checker (approvals)

- **S14.** The person who created an approval request can never decide it, regardless of their role. Enforced on the server inside `decideApproval` (test it directly against that function, since in the KYC app only analysts create requests).
- **S15.** Final statuses (`APPROVED`, `REJECTED`) can only be set through the approvals engine. There is no endpoint that sets these statuses directly.
- **S16.** Every approval decision requires a note.

## PII protection

- **S17.** PII fields (date of birth, national ID, address) are masked on the server before being sent to the browser. Unmasked values are never included in page data or API responses unless explicitly revealed.
- **S18.** Revealing a field requires the `pii.reveal` permission, record-level access to that case, and a reason of at least 10 characters. It returns only that one field and is audited (S10).
- **S19.** PII never appears in application logs or error messages.

## General

- **S20.** All inputs are validated with zod schemas; unknown fields are rejected.
- **S21.** No secrets in the repo. `.env` is git-ignored; `.env.example` documents required variables with placeholder values.
- **S22.** Errors returned to the browser are generic. Details are logged server-side only (without PII, per S19).
- **S23.** State-changing operations happen only via POST requests or server actions, never via GET.
