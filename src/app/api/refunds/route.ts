import { listRefunds, requestRefund } from "@/apps/refunds/refunds";
import { listRefundsInput, requestRefundInput } from "@/apps/refunds/schemas";
import { secureHandler } from "@/platform/handler";

export const GET = secureHandler({ permission: "refunds.refund.read", input: listRefundsInput }, ({ user, input }) => listRefunds(user, input));

export const POST = secureHandler({ permission: "refunds.refund.request", input: requestRefundInput }, ({ user, input }) => requestRefund(user, input));
