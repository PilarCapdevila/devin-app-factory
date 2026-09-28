import { RefundDetail } from "@/apps/refunds/ui/RefundDetail";
import { requireUser } from "@/platform/auth";
import { MIN_REVEAL_REASON_LENGTH } from "@/platform/pii";

export default async function RefundPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  return <RefundDetail id={id} user={user} minRevealReasonLength={MIN_REVEAL_REASON_LENGTH} />;
}
