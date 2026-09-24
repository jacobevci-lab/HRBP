"use client";

import { CirclePlay, RotateCcw, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Kind = "identity" | "integration";
type Status = "DRAFT" | "ACTIVE" | "DEGRADED" | "DISABLED";
type Action = "activate" | "disable" | "reopen";

export function ConnectionLifecycleActions({ kind, id, name, status }: { kind: Kind; id: string; name: string; status: Status }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function execute(action: Action) {
    if (busy) return;
    const activation = action === "activate";
    const promptText = activation
      ? c(`Enter an activation attestation for “${name}” (minimum 12 characters):`, `“${name}” için aktivasyon teyidi girin (en az 12 karakter):`)
      : c(`Enter a reason for ${action === "disable" ? "disabling" : "reopening"} “${name}” (minimum 8 characters):`, `“${name}” kaydını ${action === "disable" ? "devre dışı bırakmak" : "taslağa geri açmak"} için gerekçe girin (en az 8 karakter):`);
    const answer = window.prompt(promptText)?.trim();
    if (!answer) return;

    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/settings/${kind === "identity" ? "identity" : "integrations"}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(activation ? { action, attestation: answer } : { action, reason: answer })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Connection lifecycle update failed.", "Bağlantı yaşam döngüsü güncellenemedi."));
    } finally {
      setBusy(null);
    }
  }

  return <div className="connection-lifecycle-actions">
    <div>
      {status === "DRAFT" ? <button type="button" disabled={Boolean(busy)} onClick={() => void execute("activate")}><CirclePlay size={13}/>{c("Activate", "Aktifleştir")}</button> : null}
      {status === "ACTIVE" || status === "DEGRADED" ? <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void execute("disable")}><ShieldOff size={13}/>{c("Disable", "Devre dışı")}</button> : null}
      {status === "DISABLED" || status === "DEGRADED" ? <button type="button" disabled={Boolean(busy)} onClick={() => void execute("reopen")}><RotateCcw size={13}/>{c("Reopen", "Taslağa aç")}</button> : null}
    </div>
    {error ? <small>{error}</small> : null}
  </div>;
}
