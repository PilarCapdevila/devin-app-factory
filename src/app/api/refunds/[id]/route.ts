import { getRefund } from "@/apps/refunds/refunds";
import { secureHandler } from "@/platform/handler";

export const GET = secureHandler({ permission: "refunds.refund.read" }, ({ user, params }) => getRefund(user, params.id));
