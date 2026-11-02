"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, ChevronDown, ClipboardCheck, LayoutDashboard, Menu, Plus, Settings, Sparkles, UsersRound, X } from "lucide-react";
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
import { primaryShellDestinations } from "@/lib/ui-shell-navigation.mjs";

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
  const primaryDestinations = useMemo(() => primaryShellDestinations({
    authenticated,
    role: session?.user?.role,
    capabilities: [...navigationCapabilities]
  }), [authenticated, navigationCapabilities, session?.user?.role]);
  const productNavigation = useMemo(() => visibleNavigation
    .map((group) => ({ ...group, items: group.items.filter((item) => item.slug !== "dashboard") }))
    .filter((group) => group.items.length > 0), [visibleNavigation]);

  const hrefForSlug = (slug: string) => slug === "dashboard" ? "/" : `/module/${slug}`;
  const activeHref = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  const primaryIcons = {
    home: LayoutDashboard,
    work: ClipboardCheck,
    operations: Activity,
    people: UsersRound,
    insights: BarChart3,
    admin: Settings
  } as const;
  const primaryLabel = (label: "home" | "work" | "operations" | "team" | "people" | "insights" | "admin") => {
    if (label === "home") return t("nav.commandCenter");
    if (label === "work") return t("shell.myWork");
    if (label === "operations") return t("shell.operations");
    if (label === "team") return t("shell.myTeam");
    if (label === "insights") return t("shell.insights");
    if (label === "admin") return t("shell.administration");
    return t("nav.people");
  };

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
          <div className="nav-primary">
            <div className="nav-label">{t("shell.quickAccess")}</div>
            {primaryDestinations.map((item) => {
              const href = hrefForSlug(item.slug);
              const active = activeHref(href);
              const Icon = primaryIcons[item.id];
              return <Link key={item.id} href={href} className={`nav-item nav-primary-item ${active ? "active" : ""}`} onClick={() => setMobileOpen(false)}>
                <Icon size={17} strokeWidth={1.8}/><span>{primaryLabel(item.label)}</span>
              </Link>;
            })}
          </div>
          <div className="nav-separator"/>
          <div className="nav-label nav-product-label">{t("shell.productAreas")}</div>
          {productNavigation.map((group) => {
            const groupActive = group.items.some((item) => activeHref(hrefForSlug(item.slug)));
            return <details className="nav-group nav-disclosure" key={group.labelKey} open={groupActive ? true : undefined}>
              <summary><span>{t(group.labelKey)}</span><ChevronDown size={14}/></summary>
              <div className="nav-disclosure-items">
                {group.items.map((item) => {
                  const href = hrefForSlug(item.slug);
                  const active = activeHref(href);
                  const Icon = item.icon;
                  return <Link key={item.slug} href={href} className={`nav-item ${active ? "active" : ""}`} onClick={() => setMobileOpen(false)}>
                    <Icon size={17} strokeWidth={1.8}/><span>{t(item.labelKey)}</span>{item.badge && <em>{item.badge}</em>}
                  </Link>;
                })}
              </div>
            </details>;
          })}
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
