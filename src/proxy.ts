import { unsealData } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionSecret, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, type SessionData } from "@/platform/session";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

async function hasSession(request: NextRequest): Promise<boolean> {
  const seal = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!seal) return false;
  try {
    const data = await unsealData<SessionData>(seal, { password: getSessionSecret(), ttl: SESSION_TTL_SECONDS });
    return typeof data.userId === "string" && data.userId.length > 0;
  } catch {
    return false;
  }
}

/**
 * Authentication everywhere (SECURITY.md M1): unauthenticated API calls get 401 and
 * unauthenticated page requests are redirected to /login. Routes still re-check the session
 * themselves through secureHandler / requireUser.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authenticated = await hasSession(request);

  if (PUBLIC_PATHS.has(pathname)) {
    if (authenticated && pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
