import { recommend } from "@/apps/kyc/cases";
import { recommendInput } from "@/apps/kyc/schemas";
import { secureHandler } from "@/platform/handler";

export const POST = secureHandler({ permission: "kyc.case.work", input: recommendInput }, ({ user, params, input }) =>
  recommend(user, params.id, input.recommendation, input.note),
);
