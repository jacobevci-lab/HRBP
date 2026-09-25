"use client";

import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { useSessionContext } from "@/components/session-provider";
import { notificationDisplayResourceHref, notificationDisplaySummary, notificationDisplayTitle } from "@/lib/notification-display";

type NotificationItem = {
  id: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  payload: unknown;
  readAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

type NotificationResponse = {
  data?: {
    items: NotificationItem[];
    unreadCount: number;
  };
};

export function NotificationCenter() {
  const { locale, t } = useLocale();
  const { session, loading: sessionLoading } = useSessionContext();
  const authenticated = Boolean(session?.authenticated);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!authenticated) return;
    try {
      setLoading(true);
      const response = await fetch("/api/notifications?limit=8", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          setItems([]);
          setUnreadCount(0);
        }
        return;
      }
      const body = await response.json() as NotificationResponse;
      setItems(body.data?.items ?? []);
      setUnreadCount(body.data?.unreadCount ?? 0);
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  async function markRead(id: string) {
    const target = items.find((item) => item.id === id);
    if (!target || target.readAt) return;
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, read: true })
    });
    if (!response.ok) return;
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: now } : item));
    setUnreadCount((current) => Math.max(0, current - 1));
  }

  async function markAllRead() {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true, read: true })
    });
    if (!response.ok) return;
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
    setUnreadCount(0);
  }

  useEffect(() => {
    if (!authenticated) {
      setItems([]);
      setUnreadCount(0);
      setOpen(false);
      return;
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onChanged = () => void refresh();
    window.addEventListener("hrbp:notifications-changed", onChanged);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("hrbp:notifications-changed", onChanged);
    };
  }, [authenticated, refresh]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function timeLabel(value: string | null, fallback: string) {
    const date = new Date(value ?? fallback);
    return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  if (sessionLoading || !authenticated) return null;

  return (
    <div className="notification-center" ref={containerRef}>
      <button
        className="icon-button"
        aria-label={t("shell.notifications")}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void refresh();
        }}
      >
        <Bell size={18}/>
        {unreadCount > 0 ? <span className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>

      {open ? (
        <section className="notification-menu" aria-label={t("shell.notifications")}>
          <div className="notification-menu-header">
            <div>
              <strong>{t("shell.notifications")}</strong>
              <small>{locale === "tr" ? `${unreadCount} okunmamış` : `${unreadCount} unread`}</small>
            </div>
            {unreadCount > 0 ? (
              <button type="button" onClick={() => void markAllRead()}>
                <CheckCheck size={14}/>{locale === "tr" ? "Tümünü okundu yap" : "Mark all read"}
              </button>
            ) : null}
          </div>

          <div className="notification-menu-list">
            {loading && items.length === 0 ? <p className="notification-empty">{locale === "tr" ? "Bildirimler yükleniyor…" : "Loading notifications…"}</p> : null}
            {!loading && items.length === 0 ? <p className="notification-empty">{locale === "tr" ? "Yeni bildirimin yok." : "You have no new notifications."}</p> : null}
            {items.map((item) => (
              <Link
                key={item.id}
                className={`notification-menu-item ${item.readAt ? "" : "unread"}`}
                href={notificationDisplayResourceHref(item.resourceType, item.resourceId)}
                onClick={() => {
                  setOpen(false);
                  if (!item.readAt) void markRead(item.id);
                }}
              >
                <span className="notification-menu-indicator"/>
                <span className="notification-menu-copy">
                  <strong>{notificationDisplayTitle(item.eventType, locale)}</strong>
                  <span>{notificationDisplaySummary(item.payload, locale)}</span>
                  <time>{timeLabel(item.deliveredAt, item.createdAt)}</time>
                </span>
              </Link>
            ))}
          </div>

          <Link className="notification-view-all" href="/module/notifications" onClick={() => setOpen(false)}>
            {locale === "tr" ? "Tüm bildirimleri görüntüle" : "View all notifications"}
          </Link>
        </section>
      ) : null}
    </div>
  );
}
