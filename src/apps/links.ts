/** Where the shared approvals inbox links for each entity type. Add one line per new app. */
export const ENTITY_LINKS: Record<string, (entityId: string) => string> = {
  "kyc.case": (id) => `/kyc/${id}`,
  "disputes.dispute": (id) => `/disputes/${id}`,
  "refunds.refund": (id) => `/refunds/${id}`,
};

export function entityHref(entityType: string, entityId: string): string | null {
  return ENTITY_LINKS[entityType]?.(entityId) ?? null;
}
