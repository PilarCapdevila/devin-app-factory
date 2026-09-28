import { requireUser } from "@/platform/auth";
import { AppShell } from "@/platform/ui/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
