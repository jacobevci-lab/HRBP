"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { navigation } from "@/lib/navigation";
import { GlobalSearch } from "@/components/global-search";
import { SessionIndicator } from "@/components/session-indicator";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopbarAccount } from "@/components/topbar-account";
import { LocaleProvider, useLocale } from "@/components/locale-provider";
import { LocaleToggle } from "@/components/locale-toggle";
import { NotificationCenter } from "@/components/notification-center";

type SessionNavigationResponse = {
  authenticated?: boolean;
  navigationCapabilities?: string[];
  user?: { tenantName?: string | null };
};

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "H"}${parts[1]?.[0] ?? parts[0]?.[1] ?? "R"}`.toUpperCase();
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [navigationCapabilities, setNavigationCapabilities] = useState<Set<string> | null>(null);
  const { t } = useLocale();

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<SessionNavigationResponse> : null)
      .then((session) => {
        if (!active || !session) return;
        const isAuthenticated = Boolean(session.authenticated);
        setAuthenticated(isAuthenticated);
        if (isAuthenticated) {
          setNavigationCapabilities(new Set(session.navigationCapabilities ?? []));
          setTenantName(session.user?.tenantName?.trim() || null);
        } else {
          setNavigationCapabilities(null);
          setTenantName(null);
        }
      })
      .catch(() => {
        if (!active) return;
        setAuthenticated(false);
        setNavigationCapabilities(null);
        setTenantName(null);
      });
    return () => { active = false; };
  }, []);

  const visibleNavigation = useMemo(() => navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !navigationCapabilities || !item.requiredCapability || navigationCapabilities.has(item.requiredCapability))
    }))
    .filter((group) => group.items.length > 0), [navigationCapabilities]);
  const workspaceName = tenantName ?? "HRBP One";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <Link href="/" className="brand" onClick={() => setMobileOpen(false)}>
            <span className="brand-mark"><span /><span /><span /></span>
            <span><strong>HRBP</strong><small>ONE</small></span>
          </Link>
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label={t("shell.closeNavigation")}><X size={18}/></button>
        </div>
        <div className="tenant-switcher">
          <span className="tenant-avatar">{initials(workspaceName)}</span>
          <span className="tenant-copy"><strong>{workspaceName}</strong><small>{t("shell.enterpriseWorkspace")}</small></span>
          <ChevronDown size={15}/>
        </div>
        <nav className="nav-scroll">
          {visibleNavigation.map((group) => (
            <div className="nav-group" key={group.labelKey}>
              <div className="nav-label">{t(group.labelKey)}</div>
              {group.items.map((item) => {
                const href = item.slug === "dashboard" ? "/" : `/module/${item.slug}`;
                const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
                const Icon = item.icon;
                return (
                  <Link key={item.slug} href={href} className={`nav-item ${active ? "active" : ""}`} onClick={() => setMobileOpen(false)}>
                    <Icon size={17} strokeWidth={1.8}/><span>{t(item.labelKey)}</span>{item.badge && <em>{item.badge}</em>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer"><SessionIndicator/></div>
      </aside>
      {mobileOpen && <button className="sidebar-overlay" aria-label={t("shell.closeNavigation")} onClick={() => setMobileOpen(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label={t("shell.openNavigation")}><Menu size={20}/></button>
          <GlobalSearch/>
          <div className="topbar-actions">
            <LocaleToggle/>
            <ThemeToggle/>
            <NotificationCenter/>
            {authenticated && navigationCapabilities?.has("ai:use") ? <button className="ai-button"><Sparkles size={16}/> {t("shell.ask")}</button> : null}
            {authenticated && navigationCapabilities?.has("people:write") ? <Link className="create-button" href="/module/people/new"><Plus size={17}/> {t("shell.create")}</Link> : null}
            <TopbarAccount/>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <LocaleProvider><AppShellContent>{children}</AppShellContent></LocaleProvider>;
}
