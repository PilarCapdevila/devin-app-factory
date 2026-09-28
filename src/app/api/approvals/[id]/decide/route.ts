import { z } from "zod";
import { decideApproval } from "@/platform/approvals";
import { secureHandler } from "@/platform/handler";
import { DECIDE_PERMISSIONS } from "@/platform/permissions";

const decideInput = z.strictObject({
  decision: z.enum(["confirm", "return"]),
  note: z.string().trim().min(1).max(2000),
});

/**
 * The declared permission is the first gate; decideApproval re-checks the specific action's
 * decidePermission, the PENDING status and maker-checker inside its transaction.
 */
export const POST = secureHandler({ permission: DECIDE_PERMISSIONS, input: decideInput }, async ({ user, params, input }) => {
  const request = await decideApproval({ requestId: params.id, deciderId: user.id, decision: input.decision, note: input.note });
  return { ...request, payload: JSON.parse(request.payload) as unknown };
});
