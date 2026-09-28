import { getCase } from "@/apps/kyc/cases";
import { secureHandler } from "@/platform/handler";

export const GET = secureHandler({ permission: "kyc.case.read" }, ({ user, params }) => getCase(user, params.id));
