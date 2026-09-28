import { assignCase } from "@/apps/kyc/cases";
import { assignInput } from "@/apps/kyc/schemas";
import { secureHandler } from "@/platform/handler";

export const POST = secureHandler({ permission: "kyc.case.assign", input: assignInput }, ({ user, params, input }) =>
  assignCase(user, params.id, input.analystId),
);
