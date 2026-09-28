import { KycCaseDetail } from "@/apps/kyc/ui/KycCaseDetail";
import { requireUser } from "@/platform/auth";
import { MIN_REVEAL_REASON_LENGTH } from "@/platform/pii";

export default async function KycCasePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  return <KycCaseDetail id={id} user={user} minRevealReasonLength={MIN_REVEAL_REASON_LENGTH} />;
}
