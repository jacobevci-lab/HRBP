import Link from "next/link";
import { LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { getServerLocale } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const messages = {
  en: {
    configuration: "Enterprise SSO is not configured yet. Add the OIDC and session settings in the Cloudflare Worker environment.",
    provider: "The identity provider could not start the sign-in flow. Check the OIDC issuer and client configuration.",
    transaction: "The sign-in transaction expired or is no longer valid. Start again.",
    state: "The sign-in response did not pass state validation. Start a new sign-in attempt.",
    "not-provisioned": "Your identity is valid but has not been provisioned for this HRBP workspace.",
    disabled: "This HRBP account is disabled.",
    callback: "Sign-in could not be completed. Review the identity provider configuration and Worker logs."
  },
  tr: {
    configuration: "Kurumsal SSO henüz yapılandırılmamış. Cloudflare Worker ortamında OIDC ve oturum ayarlarını ekleyin.",
    provider: "Kimlik sağlayıcı giriş akışını başlatamadı. OIDC issuer ve client yapılandırmasını kontrol edin.",
    transaction: "Giriş işleminin süresi doldu veya artık geçerli değil. Yeniden başlatın.",
    state: "Giriş yanıtı state doğrulamasını geçemedi. Yeni bir giriş denemesi başlatın.",
    "not-provisioned": "Kimliğiniz geçerli ancak bu HRBP çalışma alanı için henüz provision edilmemiş.",
    disabled: "Bu HRBP hesabı devre dışı.",
    callback: "Giriş tamamlanamadı. Kimlik sağlayıcı yapılandırmasını ve Worker loglarını inceleyin."
  }
} as const;

function safeReturnTo(value: unknown) { return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/"; }

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, locale] = await Promise.all([searchParams, getServerLocale()]);
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const error = typeof params.error === "string" ? params.error : undefined;
  const signedOut = params.signedOut === "1";
  const returnTo = safeReturnTo(params.returnTo);
  const loginHref = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  const localizedMessages = messages[locale];

  return <main className="auth-screen"><section className="auth-panel">
    <div className="auth-brand"><span className="auth-brand-mark"><span/><span/><span/></span><div><strong>HRBP</strong><small>ONE</small></div></div>
    <div className="auth-kicker"><ShieldCheck size={15}/> {c("Enterprise identity","Kurumsal kimlik")}</div>
    <h1>{c("Sign in to your people workspace","Çalışan çalışma alanınıza giriş yapın")}</h1>
    <p>{c("Use your organization identity provider. HRBP validates the OIDC response, maps it to a tenant-scoped platform role and issues a short-lived signed application session.","Kuruluşunuzun kimlik sağlayıcısını kullanın. HRBP OIDC yanıtını doğrular, tenant kapsamlı platform rolüne eşler ve kısa ömürlü imzalı uygulama oturumu oluşturur.")}</p>
    {error ? <div className="auth-message error"><LockKeyhole size={17}/><span>{localizedMessages[error as keyof typeof localizedMessages] ?? c("Sign-in failed.","Giriş başarısız.")}</span></div> : null}
    {signedOut ? <div className="auth-message success"><ShieldCheck size={17}/><span>{c("Your HRBP session has been closed.","HRBP oturumunuz kapatıldı.")}</span></div> : null}
    <Link className="auth-primary" href={loginHref}><Sparkles size={17}/> {c("Continue with enterprise SSO","Kurumsal SSO ile devam et")}</Link>
    <Link className="auth-secondary" href="/">{c("Back to public staging dashboard","Herkese açık staging dashboard'a dön")}</Link>
    <div className="auth-footnote"><strong>{c("Security model","Güvenlik modeli")}</strong><span>{c("PKCE · state + nonce validation · provider JWT verification · tenant role mapping · HttpOnly signed session · no caller-supplied production role headers","PKCE · state + nonce doğrulaması · sağlayıcı JWT doğrulaması · tenant rol eşleme · HttpOnly imzalı oturum · istemciden sağlanan production rol header'ı yok")}</span></div>
  </section></main>;
}
