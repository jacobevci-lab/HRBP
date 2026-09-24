"use client";

import Link from "next/link";
import { LogIn, LogOut, ShieldCheck } from "lucide-react";
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

export function TopbarAccount() {
  const { session, loading } = useSessionContext();
  const { locale } = useLocale();

  if (loading || !session) {
    return <div className="topbar-account topbar-account-loading"><span className="topbar-avatar">…</span><span>{locale === "tr" ? "Oturum kontrol ediliyor" : "Checking session"}</span></div>;
  }

  if (!session.authenticated || !session.user) {
    return (
      <Link className="topbar-login" href="/auth/sign-in">
        <LogIn size={15}/>
        <span>{locale === "tr" ? "Giriş yap" : "Sign in"}</span>
        {session.oidcConfigured ? <ShieldCheck size={13}/> : null}
      </Link>
    );
  }

  const signOut = locale === "tr" ? "Çıkış yap" : "Sign out";
  return (
    <div className="topbar-account">
      <span className="topbar-avatar">{initials(session.user.displayName)}</span>
      <span className="topbar-account-copy"><strong>{session.user.displayName}</strong><small>{roleLabel(session.user.role, locale)}</small></span>
      <Link className="topbar-logout" href="/api/auth/logout" title={signOut} aria-label={signOut}><LogOut size={15}/></Link>
    </div>
  );
}
