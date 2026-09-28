import { getDispute } from "@/apps/disputes/disputes";
import { secureHandler } from "@/platform/handler";

export const GET = secureHandler({ permission: "disputes.dispute.read" }, ({ user, params }) => getDispute(user, params.id));
