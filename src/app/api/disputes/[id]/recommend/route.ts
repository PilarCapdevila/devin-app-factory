import { recommend } from "@/apps/disputes/disputes";
import { recommendInput } from "@/apps/disputes/schemas";
import { secureHandler } from "@/platform/handler";

export const POST = secureHandler({ permission: "disputes.dispute.work", input: recommendInput }, ({ user, params, input }) =>
  recommend(user, params.id, input.recommendation, input.note),
);
