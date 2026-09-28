import { getSessionSecret } from "@/platform/session";

/** Runs once at server start. Refuses to start without a valid SESSION_SECRET (SECURITY.md H3). */
export async function register() {
  getSessionSecret();
  if (process.env.NEXT_RUNTIME === "nodejs") await import("@/apps/register");
}
