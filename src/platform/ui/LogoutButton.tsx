"use client";

import { useRouter } from "next/navigation";
import { api } from "./client";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      Log out
    </button>
  );
}
