import { redirect } from "next/navigation";
import { getCurrentUser } from "@/platform/auth";
import { can } from "@/platform/permissions";

/** Lands users on the first app they may read; the (app) layout handles the unauthenticated case. */
export default async function Home() {
  const user = await getCurrentUser();
  redirect(user && !can(user, "kyc.case.read") && can(user, "refunds.refund.read") ? "/refunds" : "/kyc");
}
