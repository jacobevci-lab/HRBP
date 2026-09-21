"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown, Command, Menu, Plus, Search, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { navigation } from "@/lib/navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <Link href="/" className="brand" onClick={() => setMobileOpen(false)}>
            <span className="brand-mark"><span /><span /><span /></span>
            <span><strong>HRBP</strong><small>ONE</small></span>
          </Link>
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18}/></button>
        </div>
        <div className="tenant-switcher">
          <span className="tenant-avatar">AC</span>
          <span className="tenant-copy"><strong>Acme Global</strong><small>Enterprise workspace</small></span>
          <ChevronDown size={15}/>
        </div>
        <nav className="nav-scroll">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => {
                const href = item.slug === "dashboard" ? "/" : `/module/${item.slug}`;
                const active = pathname === href;
                const Icon = item.icon;
                return (
                  <Link key={item.slug} href={href} className={`nav-item ${active ? "active" : ""}`} onClick={() => setMobileOpen(false)}>
                    <Icon size={17} strokeWidth={1.8}/><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar">YE</div>
          <div className="user-copy"><strong>Yakup Evci</strong><small>Platform administrator</small></div>
          <ChevronDown size={15}/>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20}/></button>
          <div className="global-search"><Search size={17}/><input placeholder="Search people, positions, cases, documents…"/><kbd><Command size={12}/> K</kbd></div>
          <div className="topbar-actions">
            <button className="icon-button"><Bell size={18}/><span className="notification-dot"/></button>
            <button className="ai-button"><Sparkles size={16}/> Ask HRBP</button>
            <button className="create-button"><Plus size={17}/> Create</button>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
