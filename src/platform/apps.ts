let loaded: Promise<unknown> | null = null;

/**
 * Loads every app's registrations (approval actions, PII entities) exactly once.
 * The platform calls this before consulting a registry so that platform functions work
 * when imported directly (for example from tests) as well as from API routes.
 */
export function loadApps(): Promise<unknown> {
  loaded ??= import("@/apps/register");
  return loaded;
}
