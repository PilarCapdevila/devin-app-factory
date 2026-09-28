import { requireUser } from "@/platform/auth";
import { can } from "@/platform/permissions";
import { AppShell, type NavItem } from "@/platform/ui/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const appNav: NavItem[] = [
    ...(can(user, "refunds.refund.read") ? [{ href: "/refunds", label: "Refunds" }] : []),
    ...(can(user, "disputes.dispute.read") ? [{ href: "/disputes", label: "Disputes" }] : []),
  ];
  return (
    <AppShell user={user} appNav={appNav}>
      {children}
    </AppShell>
  );
}
