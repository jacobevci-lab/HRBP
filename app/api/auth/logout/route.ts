import { clearSessionCookie } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const headers = new Headers({ location: `${origin}/auth/sign-in?signedOut=1`, "cache-control": "no-store" });
  headers.append("set-cookie", clearSessionCookie());
  return new Response(null, { status: 302, headers });
}
