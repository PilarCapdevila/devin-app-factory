import { revealInput } from "@/apps/refunds/schemas";
import { REFUND_ENTITY_TYPE } from "@/apps/refunds/types";
import { secureHandler } from "@/platform/handler";
import { revealField } from "@/platform/pii";

export const POST = secureHandler(
  { permission: "pii.reveal", revealsPii: true, input: revealInput },
  ({ user, params, input }) =>
    revealField({
      user,
      entityType: REFUND_ENTITY_TYPE,
      entityId: params.id,
      field: input.field,
      reason: input.reason,
    }),
);
