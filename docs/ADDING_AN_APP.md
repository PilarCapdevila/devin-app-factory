# Adding an app to the platform

This guide adds a new app using only platform building blocks. Follow the steps in order; the
KYC app (`src/apps/kyc`) is the worked example for every step. The running example below is a
fictional **Vendor Onboarding** app (`src/apps/vendor`) whose records are `VendorProfile`s.

An app owns: its Prisma models, its `visibleWhere`, its business logic, its approval action(s),
its PII entity registration, its zod schemas, its API routes (thin) and its pages. It never owns
authentication, authorization, masking, auditing or approval decisions — those come from
`src/platform` and must not be reimplemented.

## 0. Layout to create

```
src/apps/vendor/
  types.ts            entity type + action name constants, status enums
  visibleWhere.ts     record-level access
  profiles.ts         business logic (reads through visibleWhere, writes in transactions + audit)
  register.ts         registerApprovalAction(...) + registerPiiEntity(...)
  schemas.ts          zod input schemas (z.strictObject)
  ui/                 client components built from src/platform/ui
src/app/api/vendor/...      route handlers: one line each, wrapped in secureHandler
src/app/(app)/vendor/...    pages: requireUser() + render the app's ui components
tests/unit/vendor.test.ts
```

## 1. Data model

Add the models to `prisma/schema.prisma` and create a migration:

```prisma
model VendorProfile {
  id           String   @id @default(cuid())
  legalName    String
  taxId        String            // PII
  bankAccount  String            // PII
  riskScore    Int
  status       String   @default("NEW")
  ownerId      String?
  owner        User?    @relation(fields: [ownerId], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

```bash
npx prisma migrate dev --name vendor_profiles   # writes prisma/migrations/<ts>_vendor_profiles
```

Do not touch the `AuditEvent` model or its triggers. Extend `prisma/seed-data.ts` if the app
needs demo data (keep the seed deterministic: fixed faker seed, fixed emails).

## 2. Declare permissions

Permissions are the only authorization primitive. Add the app's permissions to the role matrix in
`src/platform/permissions.ts` — this is the single place roles are mapped to permissions, and it is
what `can()` and `secureHandler` consult:

```ts
export const ROLE_PERMISSIONS = {
  analyst:  ["kyc.case.read", "kyc.case.work", "pii.reveal", "vendor.profile.read", "vendor.profile.work"],
  approver: ["kyc.case.read", "kyc.case.decide", "pii.reveal", "vendor.profile.read", "vendor.profile.decide"],
  admin:    ["kyc.case.read", "kyc.case.assign", "audit.read", "vendor.profile.read", "vendor.profile.assign"],
  auditor:  ["kyc.case.read", "audit.read", "vendor.profile.read"],
} as const;

export const DECIDE_PERMISSIONS: readonly Permission[] = ["kyc.case.decide", "vendor.profile.decide"];
```

Rules:

- Use the `<app>.<entity>.<verb>` naming scheme; `read`, `work`, `decide`, `assign` are the
  conventional verbs.
- Add the app's decide permission to `DECIDE_PERMISSIONS` so the shared approvals inbox routes
  (`GET /api/approvals`, `POST /api/approvals/:id/decide`) and the "Approvals" nav entry admit the
  app's deciders. The engine still checks the action-specific `decidePermission` on every decision.
- Never check `user.role` in app code. Always `can(user, "vendor.profile.work")`.
- The `Permission` type is derived from the matrix, so a typo in a route fails `npm run typecheck`.

Update `tests/unit/permissions.test.ts`, which asserts the exact matrix.

## 3. Write `visibleWhere`

`src/apps/vendor/visibleWhere.ts` returns a Prisma `where` fragment that every read of the app's
records spreads into its query. This is what turns record-level access into a 404 rather than a leak:

```ts
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/platform/auth";

export function visibleWhere(user: SessionUser): Prisma.VendorProfileWhereInput {
  if (user.role === "analyst") return { ownerId: user.id };
  return {};
}
```

In business logic (`profiles.ts`) every read uses it and throws `NotFoundError` when nothing matches:

```ts
const profile = await prisma.vendorProfile.findFirst({ where: { id, ...visibleWhere(user) } });
if (!profile) throw new NotFoundError();
```

`secureHandler` converts `NotFoundError` into a generic 404 and audits it as `access.denied`
(SECURITY.md M4). Never return 403 for a record outside scope.

## 4. Add PII field names

`src/platform/pii.ts` masks by **field name**, recursively, on every response that goes through
`secureHandler`. Add the app's PII field names to the registry:

```ts
export const PII_FIELD_NAMES = ["dateOfBirth", "nationalId", "address", "taxId", "bankAccount"] as const;
```

If a field should keep a suffix visible (like `nationalId` keeps its last 4), extend `maskValue`.
Then register the app's entity so reasoned reveal works with the app's own record-level access:

```ts
// src/apps/vendor/register.ts
registerPiiEntity(VENDOR_ENTITY_TYPE, {
  find: (tx, user, id) => tx.vendorProfile.findFirst({ where: { id, ...visibleWhere(user) } }),
});
```

`revealField()` does the rest: checks `pii.reveal`, validates the field name and the reason
(≥ `MIN_REVEAL_REASON_LENGTH` characters), calls `find` (404 outside scope), audits `pii.reveal`
and returns `{ field, value }`. Expose it as a `POST .../reveal` route (step 6) declared with
`revealsPii: true` — the only kind of route allowed to skip masking.

Update `tests/unit/pii.test.ts` (it asserts the exact field list).

## 5. Register approval actions

Anything that produces a final outcome (approve, reject, pay, close…) must go through the approvals
engine (SECURITY.md M5–M7). Define one action name per outcome type and register it in
`register.ts`:

```ts
// src/apps/vendor/types.ts
export const VENDOR_ENTITY_TYPE = "vendor.profile";
export const VENDOR_DECISION_ACTION = "vendor.decision";

// src/apps/vendor/register.ts
registerApprovalAction(VENDOR_DECISION_ACTION, {
  decidePermission: "vendor.profile.decide",
  async onConfirm(tx, request, decider) {
    const { recommendation } = JSON.parse(request.payload) as { recommendation: "approve" | "reject" };
    await setFinalStatus(tx, request, decider, recommendation === "approve" ? "APPROVED" : "REJECTED");
  },
  async onReturn(tx, request, decider) {
    await setFinalStatus(tx, request, decider, "IN_REVIEW");
  },
});
```

`setFinalStatus` is app code: it re-checks the record is still `PENDING_APPROVAL`, updates it with
`tx`, and calls `writeAuditEvent(tx, …)` with `before`/`after` and `request.decisionNote` as reason.
It runs inside the engine's transaction, so a failing callback rolls back the decision.

The maker side creates the request from business logic, inside a transaction, together with the
state change to `PENDING_APPROVAL`:

```ts
await withTransaction(async (tx) => {
  const after = await tx.vendorProfile.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
  await writeAuditEvent(tx, { actorId: user.id, actorRole: user.role, action: "vendor.profile.recommended",
    entityType: VENDOR_ENTITY_TYPE, entityId: id, before, after, reason: note });
  await createApprovalRequest(tx, { entityType: VENDOR_ENTITY_TYPE, entityId: id, action: VENDOR_DECISION_ACTION,
    payload: { recommendation }, requestedById: user.id, requestNote: note });
});
```

The engine enforces, for every action, that: the request is `PENDING`; the decider is not the
requester and has not already confirmed this request; the decider has `decidePermission`; a decision
note is present. Each confirmation is recorded as an `ApprovalConfirmation`; the one that completes
the request sets `decidedById`, `decidedAt` and `decisionNote` and runs `onConfirm`. Do **not** add a
route that sets a final status directly.

By default one confirmation is enough. If some requests need more than one approver, add the
optional `requiredApprovals(request)` to the registration; it is evaluated at decision time from the
stored request (usually its payload), so a rule change also covers requests that are already pending:

```ts
registerApprovalAction(VENDOR_DECISION_ACTION, {
  decidePermission: "vendor.profile.decide",
  requiredApprovals: (request) => (JSON.parse(request.payload) as { tier: string }).tier === "enterprise" ? 2 : 1,
  async onConfirm(tx, request, decider) { /* runs once, after the last required confirmation */ },
  async onReturn(tx, request, decider) { /* runs on the first return, at any step */ },
});
```

While fewer than `requiredApprovals` different approvers have confirmed, the request stays `PENDING`,
`onConfirm` is **not** called and the step is audited as `approval.step_confirmed`; the request leaves
the confirming approver's inbox and stays in the others'. The final confirmation (or any return) is
audited as `approval.confirmed` / `approval.returned` as usual. The inbox item and the request
returned by the engine carry `requiredApprovals` and `confirmations`, so a detail page can show
progress with `approvalProgressLabel(request)` from `@/platform/ui` ("1 of 2 approvals"). The refunds
app uses this for amounts over $2,000.00 (`src/apps/refunds/register.ts`).

Finally, add one import line to `src/apps/register.ts`:

```ts
import "./kyc/register";
import "./vendor/register";
```

Registrations are loaded at server start (`src/instrumentation.ts`) and lazily by the platform
(`loadApps()`), so they also work from unit tests.

If the approvals inbox should link to the app's detail page, add the entity type to
`src/apps/links.ts`:

```ts
export const ENTITY_LINKS = { "kyc.case": (id) => `/kyc/${id}`, "vendor.profile": (id) => `/vendor/${id}` };
```

## 6. Wrap every route in `secureHandler`

Routes live under `src/app/api/vendor/...` and are one line each. Every state change is `POST`;
`GET` never mutates.

```ts
// src/app/api/vendor/profiles/route.ts
export const GET = secureHandler({ permission: "vendor.profile.read", input: listProfilesInput },
  ({ user, input }) => listProfiles(user, input));

// src/app/api/vendor/profiles/[id]/recommend/route.ts
export const POST = secureHandler({ permission: "vendor.profile.work", input: recommendInput },
  ({ user, params, input }) => recommend(user, params.id, input.recommendation, input.note));

// src/app/api/vendor/profiles/[id]/reveal/route.ts
export const POST = secureHandler({ permission: "pii.reveal", revealsPii: true, input: revealInput },
  ({ user, params, input }) => revealField({ user, entityType: VENDOR_ENTITY_TYPE, entityId: params.id, ...input }));
```

`secureHandler` gives you, in order: session check (401) → permission check (403, and 403 if you
forgot `permission`) → zod validation of the JSON body or query string (400) → your function →
recursive PII masking → generic error bodies (details only in server logs, 403/404 audited).

Schemas (`schemas.ts`) must use `z.strictObject(...)` so unknown fields are rejected; use
`z.coerce.number()` for query-string numbers. Business logic signals problems by throwing
`ValidationError` (400), `ForbiddenError` (403) or `NotFoundError` (404) from `@/platform/errors`.
Never build a `Response` in app code and never `console.log` record data.

## 7. Reuse UI components

Pages under `src/app/(app)/vendor/` are server components that call `requireUser()` and render a
client component from `src/apps/vendor/ui/`. The authenticated layout (`src/app/(app)/layout.tsx`)
already wraps every page in `AppShell` (navigation, current user, logout); add the app's nav entry
there via `appNav` if it needs one. Build the app's screens from `@/platform/ui`:

| Component      | Use for                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `DataTable`    | queue/list pages (`columns`, `rows`, `rowKey`, optional `rowHref`, `emptyText`)         |
| `DetailPanel`  | key/value sections of a record                                                          |
| `MaskedField`  | a PII field: shows the masked value, asks for a reason, calls your `onReveal(reason)`  |
| `ApprovalBar`  | action buttons with optional required note (`requiresNote`) — used for both maker and checker steps |
| `AuditTrail`   | the record's audit events (`getCase`-style responses include `auditTrail`)              |
| `api()`        | fetch wrapper: JSON in/out, no caching, throws `ApiError`, redirects to `/login` on 401  |

Pass `MIN_REVEAL_REASON_LENGTH` from the server page into the client component (as the KYC detail
page does) — `@/platform/pii` is server-only. Decide what to show with `can(user, …)` — the same
permissions the routes check — so the UI never offers an action the server would refuse; the server
check remains the real control.

## 8. Add unit tests

Create `tests/unit/vendor.test.ts`. Tests run against a fresh, seeded `unit-test.db`
(`tests/unit/globalSetup.ts`), so you can use the seeded users via `tests/unit/helpers.ts`
(`alice()`, `carol()`, `dan()`, …) and call business logic directly. Cover at least:

1. `visibleWhere` per role, and that a read outside scope throws `NotFoundError`.
2. Each workflow transition, including the invalid ones (`ValidationError`).
3. Recommending creates a `PENDING` approval request and sets `PENDING_APPROVAL`.
4. Confirm → final status; return → back to `IN_REVIEW`; both write the expected audit events.
5. Maker-checker through `decideApproval`: requester cannot decide; wrong permission is 403; a second
   decision is rejected. If the action sets `requiredApprovals`: the intermediate step keeps the
   request `PENDING` and does not run `onConfirm`; the same approver cannot confirm twice; the final
   confirmation runs `onConfirm` once.
6. Reveal of the app's PII fields through `revealField` (permission, reason length, scope, audit).
7. Route-level behaviour with `secureHandler` if the app adds a non-trivial route (see
   `tests/unit/handler.test.ts` for the request helper pattern).

Then run the full gate:

```bash
npm run typecheck && npm run lint && npm test
```

## Checklist

- [ ] Prisma models + migration; deterministic seed data if needed
- [ ] Permissions added to `ROLE_PERMISSIONS` (and decide permission to `DECIDE_PERMISSIONS`)
- [ ] `visibleWhere` written and used by **every** read
- [ ] PII field names added to `PII_FIELD_NAMES`; `registerPiiEntity` + `revealsPii` reveal route
- [ ] Approval action registered; final status changed only in `onConfirm`/`onReturn`
- [ ] `src/apps/register.ts` imports the app's `register.ts`
- [ ] Every route wrapped in `secureHandler` with a declared permission and a strict schema
- [ ] Every write in `withTransaction` with `writeAuditEvent`
- [ ] Pages built from `@/platform/ui`
- [ ] Unit tests added; `npm run typecheck && npm run lint && npm test` green
