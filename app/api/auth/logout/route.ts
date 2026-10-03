import { clearSessionCookie } from "@/lib/auth-session";
import { mutationOriginAllowed } from "@/lib/request-context";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ error: "Use the sign-out button to end your session." },
    { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!request.headers.get("origin") || !mutationOriginAllowed(request) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Cross-origin sign-out blocked." }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const headers = new Headers({ location: "/auth/sign-in?signedOut=1", "cache-control": "no-store" });
  headers.append("set-cookie", clearSessionCookie());
  return new Response(null, { status: 303, headers });
}
