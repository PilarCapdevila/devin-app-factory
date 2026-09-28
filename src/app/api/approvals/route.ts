import { listPendingApprovalsFor } from "@/platform/approvals";
import { secureHandler } from "@/platform/handler";
import { DECIDE_PERMISSIONS } from "@/platform/permissions";

/** Inbox across all apps: pending requests the caller may decide, filtered per action inside. */
export const GET = secureHandler({ permission: DECIDE_PERMISSIONS }, ({ user }) => listPendingApprovalsFor(user));
