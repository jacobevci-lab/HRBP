"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionContext } from "@/components/session-provider";
import { acceptsRetryReceipt, object, parseOpsData, parsePagedOpsData, type OperationsPage, type OpsData, type RetryCommand, type RetrySnapshot } from "@/lib/notification-retry-contract";

export function useOperationsRead(filter: string, limit: number, enabled = true, after?: string | null) {
  const { session, loading } = useSessionContext(), user = session?.user;
  const allowed = Boolean(enabled && !loading && session?.authenticated && user && ["TENANT_ADMIN", "HR_OPERATIONS", "SECURITY_AUDITOR"].includes(user.role));
  const scope = JSON.stringify([user?.id, user?.tenantId, user?.role, filter, limit, after === undefined ? "legacy" : after]);
  const latest = useRef({ scope, allowed }); latest.current = { scope, allowed };
  const token = useRef<AbortController | null>(null), epoch = useRef(0);
  const generation = epoch.current;
  const [state, setState] = useState<{ scope: string; epoch: number; phase: "loading" | "ready" | "error"; data: (OpsData & { page?: OperationsPage }) | null }>({ scope, epoch: epoch.current, phase: "loading", data: null });
  const invalidate = useCallback(() => { epoch.current++; token.current?.abort(); token.current = null; setState({ scope, epoch: epoch.current, phase: "error", data: null }); }, [scope]);
  const load = useCallback(async () => {
    if (!user || !latest.current.allowed || latest.current.scope !== scope || token.current) return;
    const controller = new AbortController(); token.current = controller; epoch.current++;
    setState({ scope, epoch: epoch.current, phase: "loading", data: null });
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/settings/notifications/operations?status=${filter}&limit=${limit}${after === undefined ? "" : `&after=${encodeURIComponent(after ?? "")}`}`, {
        cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal
      });
      if (response.status !== 200 || response.redirected) throw Error("UNAVAILABLE");
      const body: unknown = await response.json(), data = object(body) ? (after === undefined ? parseOpsData(body.data, user, filter, limit) : parsePagedOpsData(body.data, user, filter, limit, after)) : null;
      if (!data) throw Error("INVALID_RESPONSE");
      if (token.current === controller && latest.current.allowed && latest.current.scope === scope) setState({ scope, epoch: epoch.current, phase: "ready", data });
    } catch {
      if (token.current === controller && latest.current.allowed && latest.current.scope === scope) setState({ scope, epoch: epoch.current, phase: "error", data: null });
    } finally { clearTimeout(timer); if (token.current === controller) token.current = null; }
  }, [scope, allowed]); // Locale changes are not authorization or reread events.
  useEffect(() => { void load(); return () => { epoch.current++; token.current?.abort(); token.current = null; }; }, [load]);
  const data = allowed && state.scope === scope && state.epoch === epoch.current && state.phase === "ready" ? state.data : null;
  const current = () => Boolean(data && latest.current.allowed && latest.current.scope === scope && !token.current && epoch.current === generation);
  return { data, page: after === undefined ? null : data?.page ?? null, current, load, invalidate, allowed, loading: allowed && (state.scope !== scope || state.phase === "loading"), error: allowed && state.scope === scope && state.phase === "error" };
}

type Phase = "pending" | "saved" | "conflict" | "denied" | "unknown";
export function useNotificationRetry(tr: boolean, canWrite = true) {
  const { session, loading } = useSessionContext(), user = session?.user;
  const allowed = Boolean(canWrite && !loading && session?.authenticated && user?.role === "TENANT_ADMIN");
  const owner = JSON.stringify([user?.id, user?.tenantId, user?.role]);
  const latest = useRef({ owner, allowed }); latest.current = { owner, allowed };
  const mounted = useRef(true), pending = useRef(false);
  const history = useRef<Array<{ owner: string; ids: string[]; phase: Phase }>>([]);
  const [, render] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && latest.current.allowed && latest.current.owner === owner;
  const redraw = () => { if (mounted.current) render(n => n + 1); };
  const blocked = (items: RetrySnapshot[]) => !allowed || pending.current || history.current.length >= 32 || !items.length ||
    history.current.some(h => h.owner === owner && items.some(i => h.ids.includes(i.id)));
  async function run(mode: RetryCommand["mode"], items: RetrySnapshot[], applicable: () => boolean) {
    if (!user || !current() || blocked(items) || !applicable()) return;
    pending.current = true;
    try {
      const confirm = tr ? `${items.length} incelenmiş bildirim yeniden kuyruğa alınsın mı? Bu teslim onayı değildir; önceki dış gönderim belirsizse mükerrer mesaj oluşabilir.`
        : `Requeue ${items.length} reviewed notifications? This is not delivery confirmation; an uncertain prior external send may cause duplicate messages.`;
      if (!window.confirm(confirm) || !current() || !applicable()) { pending.current = false; redraw(); return; }
      const command: RetryCommand = { commandId: crypto.randomUUID(), mode, items: items.map(i => ({ ...i })) };
      const outcome = { owner, ids: items.map(i => i.id), phase: "pending" as Phase };
      history.current.push(outcome); redraw();
      try {
        const response = await fetch("/api/settings/notifications/retry", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
          signal: AbortSignal.timeout(30000), headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
        outcome.phase = "unknown";
        if (response.status === 200 && !response.redirected) {
          const body: unknown = await response.json();
          if (object(body) && acceptsRetryReceipt(body.data, command, user)) outcome.phase = "saved";
        } else if ([401, 403].includes(response.status)) outcome.phase = "denied";
        else if ([400, 404, 409].includes(response.status)) outcome.phase = "conflict";
      } catch { outcome.phase = "unknown"; }
      return current() ? outcome.phase : undefined;
    } catch { return undefined; } finally { pending.current = false; redraw(); }
  }
  const outcome = history.current.filter(h => h.owner === owner).at(-1);
  const message = outcome?.phase === "saved" ? (tr ? `${outcome.ids.length} bildirim yeniden kuyruğa alındı. Gönderim veya teslim doğrulanmadı.` : `${outcome.ids.length} notifications requeued. Sending or delivery is not confirmed.`)
    : outcome?.phase === "unknown" ? (tr ? "İşlem sonucu doğrulanamadı. Yeniden göndermeden önce kuyruk ve sağlayıcı kayıtlarını kontrol edin." : "The result is unknown. Review queue and provider records before another request.")
    : outcome?.phase === "conflict" ? (tr ? "İncelenen kayıtlar değişmiş veya kullanılamıyor. Güncel kayıtları kontrol edin; otomatik tekrar yapılmadı." : "Reviewed records changed or are unavailable. Review current records; no automatic retry occurred.")
    : outcome?.phase === "denied" ? (tr ? "Oturum veya yetki işlemi reddetti. Erişiminizi doğrulayın." : "Your session or permissions denied the request. Verify your access.")
    : outcome?.phase === "pending" ? (tr ? "Yeniden kuyruğa alınıyor…" : "Requeuing…")
    : history.current.length >= 32 ? (tr ? "Devam etmeden önce ayarları yeniden yükleyin." : "Reload settings before continuing.") : "";
  return { allowed, blocked, run, message, phase: outcome?.phase, pending: pending.current };
}
