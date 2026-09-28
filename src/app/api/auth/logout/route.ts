import { getCurrentUser, logout } from "@/platform/auth";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await logout();
  return Response.json({ ok: true });
}
