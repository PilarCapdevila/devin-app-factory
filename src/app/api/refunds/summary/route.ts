import { summarizeRefunds } from "@/apps/refunds/refunds";
import { secureHandler } from "@/platform/handler";

export const GET = secureHandler({ permission: "refunds.refund.read" }, ({ user }) => summarizeRefunds(user));
