import { listAnalysts } from "@/apps/disputes/disputes";
import { secureHandler } from "@/platform/handler";

/** Analysts a dispute can be assigned to; only for users who may assign. */
export const GET = secureHandler({ permission: "disputes.dispute.assign" }, () => listAnalysts());
