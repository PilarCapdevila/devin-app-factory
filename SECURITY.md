# Security Requirements

This document overrides SPEC.md. Rules are in three tiers:

- **Must-prove (M):** the trust controls. Each must have at least one test in `tests/security/`, named with its ID (e.g. `M4: analyst gets 404 for a case assigned to someone else`).
- **Hygiene (H):** must be followed; verified by code review, not individual tests.
- **Stretch (X):** do not implement unless explicitly asked.

## Must-prove

- **M1. Authentication everywhere.** Every page and API route except `/login` and `POST /api/auth/login` requires a valid session. Unauthenticated API calls return 401; unauthenticated page requests redirect to `/login`.
- **M2. Deny by default.** Every API route is wrapped in `secureHandler` with a declared permission. A handler with no declared permission returns 403 for every call.
- **M3. Server-side permissions.** Every permission in the SPEC section 8 matrix is enforced on the server for every role. The role comes from the server-side session, never from client input.
- **M4. Record-level access.** An analyst can only see or act on cases assigned to them. Other cases are absent from lists, and requesting one by ID returns 404 (not 403), so IDs cannot be probed.
- **M5. Separation of duties.** Admin cannot decide approval requests or reveal PII. Only users with an action's `decidePermission` can decide it.
- **M6. Maker-checker.** The requester of an approval request can never decide it, regardless of role. Enforced inside `decideApproval` (test it directly against that function).
- **M7. Final outcomes only through approvals.** No route sets a final status (`APPROVED`, `REJECTED`) directly; only `decideApproval` can. Every decision requires a note.
- **M8. Complete audit.** Every state change writes an audit event in the same transaction; if the audit write fails, the change is rolled back. Every PII reveal and every denied request (403/404) by a logged-in user is also audited. Each event records actor, actor role, action, entity type and ID, before and after state, reason, and server timestamp.
- **M9. Append-only audit.** Database triggers reject any `UPDATE` or `DELETE` on the AuditEvent table.
- **M10. PII masked by default.** No API response contains an unmasked PII field unless its route is declared `revealsPii`. Revealing requires `pii.reveal`, record-level access to that case, and a reason of at least 10 characters; it returns only that one field and is audited.

## Hygiene

- **H1.** Session cookie is encrypted, `httpOnly`, `sameSite=lax`, `secure` in production, and expires after 8 hours.
- **H2.** Passwords are hashed with bcrypt or argon2; passwords and session contents are never logged.
- **H3.** The session secret comes from an environment variable; the app refuses to start if it is missing or shorter than 32 characters.
- **H4.** All inputs are validated with zod; unknown fields are rejected.
- **H5.** No secrets in the repo. `.env` is git-ignored; `.env.example` lists required variables with placeholders.
- **H6.** Errors returned to the browser are generic; details are logged server-side only.
- **H7.** PII never appears in logs or error messages.
- **H8.** State changes happen only through POST requests, never GET.

## Stretch (do not implement unless asked)

- **X1.** Tamper-evident hash chain on audit events with a verification endpoint.
- **X2.** Real SSO via OIDC.
