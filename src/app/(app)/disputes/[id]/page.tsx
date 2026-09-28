import { DisputeDetail } from "@/apps/disputes/ui/DisputeDetail";
import { requireUser } from "@/platform/auth";
import { MIN_REVEAL_REASON_LENGTH } from "@/platform/pii";

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  return <DisputeDetail id={id} user={user} minRevealReasonLength={MIN_REVEAL_REASON_LENGTH} />;
}
