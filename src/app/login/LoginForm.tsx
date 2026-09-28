"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/platform/ui/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "Invalid email or password." : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="text-sm">
        Email
        <input
          type="email"
          required
          autoComplete="username"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="text-sm">
        Password
        <input
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">
        Sign in
      </button>
    </form>
  );
}
