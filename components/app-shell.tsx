"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Plus, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { navigation } from "@/lib/navigation";
import { GlobalSearch } from "@/components/global-search";
import { SessionIndicator } from "@/components/session-indicator";
import { SessionProvider, useSessionContext } from "@/components/session-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopbarAccount } from "@/components/topbar-account";
import { LocaleProvider, useLocale } from "@/components/locale-provider";
import { LocaleToggle } from "@/components/locale-toggle";
import { NotificationCenter } from "@/components/notification-center";

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "H"}${parts[1]?.[0] ?? parts[0]?.[1] ?? "R"}`.toUpperCase();
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { session, loading } = useSessionContext();
  const { t } = useLocale();
  const authenticated = Boolean(session?.authenticated);
  const navigationCapabilities = useMemo(() => new Set(session?.navigationCapabilities ?? []), [session?.navigationCapabilities]);

  const visibleNavigation = useMemo(() => navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.requiredCapability) return authenticated && navigationCapabilities.has(item.requiredCapability);
        if (item.requiresAuthentication) return authenticated;
        return true;
      })
    }))
    .filter((group) => group.items.length > 0), [authenticated, navigationCapabilities]);
  const workspaceName = session?.user?.tenantName?.trim() || "HRBP One";

  return (
    <div className="app-shell" data-session-loading={loading ? "true" : "false"}>
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
            {authenticated && navigationCapabilities.has("ai:use") ? <Link className="ai-button" href="/module/ai-assistant"><Sparkles size={16}/> {t("shell.ask")}</Link> : null}
            {authenticated && navigationCapabilities.has("people:write") ? <Link className="create-button" href="/module/people/new"><Plus size={17}/> {t("shell.create")}</Link> : null}
            <TopbarAccount/>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <LocaleProvider><SessionProvider><AppShellContent>{children}</AppShellContent></SessionProvider></LocaleProvider>;
}
