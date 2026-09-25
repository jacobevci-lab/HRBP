"use client";

import Link from "next/link";
import { Bell, CheckCheck, Circle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { notificationDisplayResourceHref, notificationDisplaySummary, notificationDisplayTitle } from "@/lib/notification-display";

type NotificationItem = {
  id: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  payload: unknown;
  classification: string;
  readAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

type NotificationResponse = { data?: { items: NotificationItem[]; unreadCount: number } };

function notifyBadgeChanged() {
  window.dispatchEvent(new Event("hrbp:notifications-changed"));
}

export function NotificationsModulePage() {
  const { locale } = useLocale();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (nextUnreadOnly: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/notifications?limit=50${nextUnreadOnly ? "&unread=true" : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "AUTH" : `HTTP ${response.status}`);
      const body = await response.json() as NotificationResponse;
      setItems(body.data?.items ?? []);
      setUnreadCount(body.data?.unreadCount ?? 0);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "AUTH"
        ? (locale === "tr" ? "Bildirimleri görmek için oturum açmalısın." : "Sign in to view notifications.")
        : (locale === "tr" ? "Bildirimler şu anda yüklenemiyor." : "Notifications cannot be loaded right now."));
    } finally {
      setLoading(false);
    }
  }, [locale]);

  async function updateRead(id: string, read: boolean) {
    const target = items.find((item) => item.id === id);
    const wasRead = Boolean(target?.readAt);
    if (wasRead === read) return;

    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, read })
    });
    if (!response.ok) return;
    if (unreadOnly && read) {
      setItems((current) => current.filter((item) => item.id !== id));
    } else {
      setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: read ? new Date().toISOString() : null } : item));
    }
    setUnreadCount((current) => Math.max(0, current + (read ? -1 : 1)));
    notifyBadgeChanged();
  }

  async function markAllRead() {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true, read: true })
    });
    if (!response.ok) return;
    const now = new Date().toISOString();
    setUnreadCount(0);
    setItems((current) => unreadOnly ? [] : current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
    notifyBadgeChanged();
  }

  useEffect(() => {
    void refresh(unreadOnly);
  }, [refresh, unreadOnly]);

  function formatDate(item: NotificationItem) {
    return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(item.deliveredAt ?? item.createdAt));
  }

  return (
    <div className="notifications-page">
      <div className="page-heading notifications-heading">
        <div>
          <span className="eyebrow">{locale === "tr" ? "Aksiyon merkezi" : "Action center"}</span>
          <h1>{locale === "tr" ? "Bildirimler" : "Notifications"}</h1>
          <p>{locale === "tr" ? `${unreadCount} okunmamış bildirim` : `${unreadCount} unread notifications`}</p>
        </div>
        <div className="notifications-actions">
          <button className="secondary-button" type="button" onClick={() => void refresh(unreadOnly)} disabled={loading}>
            <RefreshCw size={15}/>{locale === "tr" ? "Yenile" : "Refresh"}
          </button>
          <button className="secondary-button" type="button" onClick={() => void markAllRead()} disabled={unreadCount === 0}>
            <CheckCheck size={15}/>{locale === "tr" ? "Tümünü okundu yap" : "Mark all read"}
          </button>
        </div>
      </div>

      <div className="notifications-toolbar card">
        <div className="notifications-filter">
          <button className={!unreadOnly ? "active" : ""} type="button" onClick={() => setUnreadOnly(false)}>
            {locale === "tr" ? "Tümü" : "All"}
          </button>
          <button className={unreadOnly ? "active" : ""} type="button" onClick={() => setUnreadOnly(true)}>
            {locale === "tr" ? "Okunmamış" : "Unread"}<span>{unreadCount}</span>
          </button>
        </div>
      </div>

      <section className="notifications-list card">
        {loading && items.length === 0 ? <div className="notifications-state"><RefreshCw size={20}/><p>{locale === "tr" ? "Bildirimler yükleniyor…" : "Loading notifications…"}</p></div> : null}
        {error ? <div className="notifications-state error"><Bell size={20}/><p>{error}</p></div> : null}
        {!loading && !error && items.length === 0 ? <div className="notifications-state"><CheckCheck size={22}/><p>{locale === "tr" ? "Bu görünümde bildirim yok." : "No notifications in this view."}</p></div> : null}

        {items.map((item) => (
          <article key={item.id} className={`notification-row ${item.readAt ? "" : "unread"}`}>
            <div className="notification-row-icon"><Bell size={17}/></div>
            <div className="notification-row-main">
              <div className="notification-row-title">
                <strong>{notificationDisplayTitle(item.eventType, locale)}</strong>
                {!item.readAt ? <span><Circle size={7} fill="currentColor"/>{locale === "tr" ? "Yeni" : "New"}</span> : null}
              </div>
              <p>{notificationDisplaySummary(item.payload, locale)}</p>
              <div className="notification-row-meta">
                <time>{formatDate(item)}</time>
                <span>{item.classification.replaceAll("_", " ")}</span>
                <span>{item.resourceType}</span>
              </div>
            </div>
            <div className="notification-row-actions">
              <button type="button" onClick={() => void updateRead(item.id, !item.readAt)}>
                {item.readAt
                  ? (locale === "tr" ? "Okunmadı yap" : "Mark unread")
                  : (locale === "tr" ? "Okundu yap" : "Mark read")}
              </button>
              <Link href={notificationDisplayResourceHref(item.resourceType, item.resourceId)} onClick={() => !item.readAt && void updateRead(item.id, true)}>
                {locale === "tr" ? "Kaydı aç" : "Open record"}
              </Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
