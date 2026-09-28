import { listAnalysts } from "@/apps/kyc/cases";
import { secureHandler } from "@/platform/handler";

/** Analysts a case can be assigned to; only for users who may assign. */
export const GET = secureHandler({ permission: "kyc.case.assign" }, () => listAnalysts());
