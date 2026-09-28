import { startReview } from "@/apps/disputes/disputes";
import { secureHandler } from "@/platform/handler";

export const POST = secureHandler({ permission: "disputes.dispute.work" }, ({ user, params }) => startReview(user, params.id));
