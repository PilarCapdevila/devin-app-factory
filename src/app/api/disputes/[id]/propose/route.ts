import { propose } from "@/apps/disputes/disputes";
import { proposeInput } from "@/apps/disputes/schemas";
import { secureHandler } from "@/platform/handler";

export const POST = secureHandler({ permission: "disputes.dispute.work", input: proposeInput }, ({ user, params, input }) =>
  propose(user, params.id, input),
);
