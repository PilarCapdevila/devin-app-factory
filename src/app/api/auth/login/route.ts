import { z } from "zod";
import { login } from "@/platform/auth";

const loginInput = z.strictObject({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

/** Public route: the only API endpoint that does not require a session. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  const parsed = loginInput.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  const user = await login(parsed.data.email, parsed.data.password);
  if (!user) return Response.json({ error: "Invalid credentials" }, { status: 401 });
  return Response.json({ user });
}
