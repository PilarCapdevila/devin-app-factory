import { listDisputes } from "@/apps/disputes/disputes";
import { listDisputesInput } from "@/apps/disputes/schemas";
import { secureHandler } from "@/platform/handler";

export const GET = secureHandler({ permission: "disputes.dispute.read", input: listDisputesInput }, ({ user, input }) => listDisputes(user, input));
