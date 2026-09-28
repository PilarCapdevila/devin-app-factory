import { RefundsDashboard } from "@/apps/refunds/ui/RefundsDashboard";
import { requireUser } from "@/platform/auth";

export default async function RefundsPage() {
  const user = await requireUser();
  return <RefundsDashboard user={user} />;
}
