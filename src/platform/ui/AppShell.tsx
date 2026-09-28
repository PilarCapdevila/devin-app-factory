import Link from "next/link";
import type { SessionUser } from "@/platform/auth";
import { can, DECIDE_PERMISSIONS } from "@/platform/permissions";
import { LogoutButton } from "./LogoutButton";

export type NavItem = { href: string; label: string };

/** Every app's pages render inside this shell: navigation, current user and logout. */
export function AppShell({ user, children, appNav = [] }: { user: SessionUser; children: React.ReactNode; appNav?: NavItem[] }) {
  const nav: NavItem[] = [
    { href: "/kyc", label: "KYC Queue" },
    ...appNav,
    ...(DECIDE_PERMISSIONS.some((p) => can(user, p)) ? [{ href: "/approvals", label: "Approvals" }] : []),
    ...(can(user, "audit.read") ? [{ href: "/audit", label: "Audit log" }] : []),
  ];
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-6">
            <span className="font-semibold tracking-tight">Internal Tools</span>
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-slate-600 hover:text-slate-900">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {user.name} <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide">{user.role}</span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
