import Link from "next/link";
import { LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const messages: Record<string, string> = {
  configuration: "Enterprise SSO is not configured yet. Add the OIDC and session settings in the Cloudflare Worker environment.",
  provider: "The identity provider could not start the sign-in flow. Check the OIDC issuer and client configuration.",
  transaction: "The sign-in transaction expired or is no longer valid. Start again.",
  state: "The sign-in response did not pass state validation. Start a new sign-in attempt.",
  "not-provisioned": "Your identity is valid but has not been provisioned for this HRBP workspace.",
  disabled: "This HRBP account is disabled.",
  callback: "Sign-in could not be completed. Review the identity provider configuration and Worker logs."
};

function safeReturnTo(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const signedOut = params.signedOut === "1";
  const returnTo = safeReturnTo(params.returnTo);
  const loginHref = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

  return <main className="auth-screen">
    <section className="auth-panel">
      <div className="auth-brand"><span className="auth-brand-mark"><span/><span/><span/></span><div><strong>HRBP</strong><small>ONE</small></div></div>
      <div className="auth-kicker"><ShieldCheck size={15}/> Enterprise identity</div>
      <h1>Sign in to your people workspace</h1>
      <p>Use your organization identity provider. HRBP validates the OIDC response, maps it to a tenant-scoped platform role and issues a short-lived signed application session.</p>

      {error ? <div className="auth-message error"><LockKeyhole size={17}/><span>{messages[error] ?? "Sign-in failed."}</span></div> : null}
      {signedOut ? <div className="auth-message success"><ShieldCheck size={17}/><span>Your HRBP session has been closed.</span></div> : null}

      <Link className="auth-primary" href={loginHref}><Sparkles size={17}/> Continue with enterprise SSO</Link>
      <Link className="auth-secondary" href="/">Back to public staging dashboard</Link>

      <div className="auth-footnote">
        <strong>Security model</strong>
        <span>PKCE · state + nonce validation · provider JWT verification · tenant role mapping · HttpOnly signed session · no caller-supplied production role headers</span>
      </div>
    </section>
  </main>;
}
