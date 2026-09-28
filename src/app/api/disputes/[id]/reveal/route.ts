import { revealInput } from "@/apps/disputes/schemas";
import { DISPUTES_ENTITY_TYPE } from "@/apps/disputes/types";
import { secureHandler } from "@/platform/handler";
import { revealField } from "@/platform/pii";

export const POST = secureHandler({ permission: "pii.reveal", revealsPii: true, input: revealInput }, ({ user, params, input }) =>
  revealField({ user, entityType: DISPUTES_ENTITY_TYPE, entityId: params.id, field: input.field, reason: input.reason }),
);
