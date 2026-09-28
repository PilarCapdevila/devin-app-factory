import { assignDispute } from "@/apps/disputes/disputes";
import { assignInput } from "@/apps/disputes/schemas";
import { secureHandler } from "@/platform/handler";

export const POST = secureHandler({ permission: "disputes.dispute.assign", input: assignInput }, ({ user, params, input }) =>
  assignDispute(user, params.id, input.analystId),
);
