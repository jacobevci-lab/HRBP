"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Plus, Sparkles, X } from "lucide-react";
import { useId, useMemo } from "react";
import { navigation } from "@/lib/navigation";
import { GlobalSearch } from "@/components/global-search";
import { SessionIndicator } from "@/components/session-indicator";
import { SessionProvider, useSessionContext } from "@/components/session-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopbarAccount } from "@/components/topbar-account";
import { LocaleProvider, useLocale } from "@/components/locale-provider";
import { LocaleToggle } from "@/components/locale-toggle";
import { NotificationCenter } from "@/components/notification-center";
import { useNavigationDrawer } from "@/components/navigation-drawer";
import styles from "@/components/navigation-drawer.module.css";

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "H"}${parts[1]?.[0] ?? parts[0]?.[1] ?? "R"}`.toUpperCase();
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const drawer = useNavigationDrawer(pathname);
  const mobileOpen = drawer.open;
  const navigationId = useId();
  const { session, loading } = useSessionContext();
  const { t, locale } = useLocale();
  const authenticated = Boolean(session?.authenticated);
  const navigationCapabilities = useMemo(() => new Set(session?.navigationCapabilities ?? []), [session?.navigationCapabilities]);

  const visibleNavigation = useMemo(() => navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        // While the identity context is still loading, keep the shell stable and
        // avoid flashing privileged navigation for an authenticated user.
        if (loading) return !item.requiredCapability && !item.requiresAuthentication;

        // Public staging is intentionally a read-only product demo. Keep the
        // complete product navigation discoverable; individual pages still
        // enforce their own authorization and mutation guards server-side.
        if (!authenticated) return true;

        if (item.requiredCapability) return navigationCapabilities.has(item.requiredCapability);
        if (item.requiresAuthentication) return true;
        return true;
      })
    }))
    .filter((group) => group.items.length > 0), [authenticated, loading, navigationCapabilities]);
  const workspaceName = session?.user?.tenantName?.trim() || "HRBP One";

  return (
    <div className={`app-shell ${styles.shell}`} data-session-loading={loading ? "true" : "false"}>
      <aside ref={drawer.sidebarRef} id={navigationId} className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}
        role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen || undefined}
        aria-label={locale === "tr" ? "Ana gezinme" : "Main navigation"}>
        <div className="brand-row">
          <Link href="/" className="brand" onClick={() => drawer.close(false)}>
            <span className="brand-mark"><span /><span /><span /></span>
            <span><strong>HRBP</strong><small>ONE</small></span>
          </Link>
          <button type="button" className="icon-button mobile-close" onClick={() => drawer.close()} aria-label={t("shell.closeNavigation")}><X size={18}/></button>
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
                  <Link key={item.slug} href={href} className={`nav-item ${active ? "active" : ""}`} onClick={() => drawer.close(false)}>
                    <Icon size={17} strokeWidth={1.8}/><span>{t(item.labelKey)}</span>{item.badge && <em>{item.badge}</em>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer"><SessionIndicator/></div>
      </aside>
      {mobileOpen && <button type="button" tabIndex={-1} className="sidebar-overlay" aria-label={t("shell.closeNavigation")} onClick={() => drawer.close()} />}
      <main ref={drawer.mainRef} className="main-area">
        <header className="topbar">
          <button ref={drawer.toggleRef} type="button" className="icon-button mobile-menu" onClick={drawer.show}
            aria-expanded={mobileOpen} aria-controls={navigationId} aria-label={t("shell.openNavigation")}><Menu size={20}/></button>
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
