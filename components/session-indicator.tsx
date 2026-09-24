"use client";

import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { useSessionContext } from "@/components/session-provider";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
}

function roleLabel(role: string, locale: "en" | "tr") {
  if (locale === "tr") {
    const labels: Record<string, string> = {
      EMPLOYEE: "Çalışan",
      MANAGER: "Yönetici",
      HRBP: "İK İş Ortağı",
      HR_OPERATIONS: "İK Operasyonları",
      TIME_ADMIN: "Zaman Yöneticisi",
      TALENT_ADMIN: "Yetenek Yöneticisi",
      COMPENSATION_ADMIN: "Ücret Yöneticisi",
      PAYROLL_ADMIN: "Bordro Yöneticisi",
      TENANT_ADMIN: "Tenant Yöneticisi",
      ER_INVESTIGATOR: "Çalışan İlişkileri İnceleyicisi",
      LEGAL: "Hukuk",
      PRIVACY_OFFICER: "Gizlilik Sorumlusu"
    };
    if (labels[role]) return labels[role];
  }
  return role.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function SessionIndicator() {
  const { session, loading } = useSessionContext();
  const { locale } = useLocale();

  if (loading || !session) {
    return <div className="session-identity"><div className="user-avatar">…</div><div className="user-copy"><strong>{locale === "tr" ? "Oturum kontrol ediliyor" : "Checking session"}</strong><small>{locale === "tr" ? "Kimlik bağlamı" : "Identity context"}</small></div></div>;
  }

  if (!session.authenticated || !session.user) {
    const signIn = locale === "tr" ? "Giriş yap" : "Sign in";
    return <div className="session-identity">
      <div className="user-avatar demo">DM</div>
      <div className="user-copy"><strong>{locale === "tr" ? "Genel staging" : "Public staging"}</strong><small>{session.oidcConfigured ? (locale === "tr" ? "SSO kullanılabilir" : "SSO available") : (locale === "tr" ? "Salt-okunur demo" : "Read-only demo")}</small></div>
      <Link href="/auth/sign-in" className="session-action" title={signIn}><LogIn size={15}/></Link>
    </div>;
  }

  const signOut = locale === "tr" ? "Çıkış yap" : "Sign out";
  return <div className="session-identity">
    <div className="user-avatar">{initials(session.user.displayName)}</div>
    <div className="user-copy"><strong>{session.user.displayName}</strong><small>{roleLabel(session.user.role, locale)}</small></div>
    <Link href="/api/auth/logout" className="session-action" title={signOut}><LogOut size={15}/></Link>
  </div>;
}
