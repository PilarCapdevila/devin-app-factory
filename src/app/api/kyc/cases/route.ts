import { listCases } from "@/apps/kyc/cases";
import { listCasesInput } from "@/apps/kyc/schemas";
import { secureHandler } from "@/platform/handler";

export const GET = secureHandler({ permission: "kyc.case.read", input: listCasesInput }, ({ user, input }) => listCases(user, input));
