import { startReview } from "@/apps/kyc/cases";
import { secureHandler } from "@/platform/handler";

export const POST = secureHandler({ permission: "kyc.case.work" }, ({ user, params }) => startReview(user, params.id));
