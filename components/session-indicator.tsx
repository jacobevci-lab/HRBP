"use client";

import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { useEffect, useState } from "react";

type SessionResponse = {
  authenticated: boolean;
  oidcConfigured: boolean;
  user?: {
    displayName: string;
    email: string | null;
    role: string;
  };
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
}

function roleLabel(role: string) {
  return role.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function SessionIndicator() {
  const [session, setSession] = useState<SessionResponse | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<SessionResponse>)
      .then((value) => { if (active) setSession(value); })
      .catch(() => { if (active) setSession({ authenticated: false, oidcConfigured: false }); });
    return () => { active = false; };
  }, []);

  if (!session) {
    return <div className="session-identity"><div className="user-avatar">…</div><div className="user-copy"><strong>Checking session</strong><small>Identity context</small></div></div>;
  }

  if (!session.authenticated || !session.user) {
    return <div className="session-identity">
      <div className="user-avatar demo">DM</div>
      <div className="user-copy"><strong>Public staging</strong><small>{session.oidcConfigured ? "SSO available" : "Read-only demo"}</small></div>
      <Link href="/auth/sign-in" className="session-action" title="Sign in"><LogIn size={15}/></Link>
    </div>;
  }

  return <div className="session-identity">
    <div className="user-avatar">{initials(session.user.displayName)}</div>
    <div className="user-copy"><strong>{session.user.displayName}</strong><small>{roleLabel(session.user.role)}</small></div>
    <Link href="/api/auth/logout" className="session-action" title="Sign out"><LogOut size={15}/></Link>
  </div>;
}
