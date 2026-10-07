"use client";

import { BadgeCheck, CirclePlay, RotateCcw, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Kind = "identity" | "integration";
type Status = "DRAFT" | "ACTIVE" | "DEGRADED" | "DISABLED";
type Action = "validate" | "activate" | "disable" | "reopen";

export function ConnectionLifecycleActions({ kind, id, name, status, validated }: { kind: Kind; id: string; name: string; status: Status; validated: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function execute(action: Action) {
    if (busy) return;
    const activation = action === "activate";
    const validation = action === "validate";
    const promptText = validation ? null : activation
      ? c(`Enter an activation attestation for “${name}” (minimum 12 characters):`, `“${name}” için aktivasyon teyidi girin (en az 12 karakter):`)
      : c(`Enter a reason for ${action === "disable" ? "disabling" : "reopening"} “${name}” (minimum 8 characters):`, `“${name}” kaydını ${action === "disable" ? "devre dışı bırakmak" : "taslağa geri açmak"} için gerekçe girin (en az 8 karakter):`);
    const answer = promptText ? window.prompt(promptText)?.trim() : undefined;
    if (promptText && !answer) return;

    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/settings/${kind === "identity" ? "identity" : "integrations"}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validation ? { action } : activation ? { action, attestation: answer } : { action, reason: answer })
      });
      const body = await response.json() as { error?: string; code?: string };
      if (!response.ok) {
        const detail = body.code ? `${body.error || "Validation failed"} (${body.code})` : (body.error || `HTTP ${response.status}`);
        throw new Error(detail);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Connection lifecycle update failed.", "Bağlantı yaşam döngüsü güncellenemedi."));
    } finally {
      setBusy(null);
    }
  }

  return <div className="connection-lifecycle-actions">
    <div>
      {status === "DRAFT" ? <button type="button" disabled={Boolean(busy)} onClick={() => void execute("validate")}><BadgeCheck size={13}/>{kind === "identity"
  ? (validated ? c("Revalidate provider", "Sağlayıcıyı tekrar doğrula") : c("Validate provider", "Sağlayıcıyı doğrula"))
  : (validated ? c("Revalidate config", "Yapıyı tekrar doğrula") : c("Validate config", "Yapıyı doğrula"))}</button> : null}
      {status === "DRAFT" ? <button type="button" disabled={Boolean(busy) || !validated} onClick={() => void execute("activate")}><CirclePlay size={13}/>{c("Activate", "Aktifleştir")}</button> : null}
      {status === "ACTIVE" || status === "DEGRADED" ? <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void execute("disable")}><ShieldOff size={13}/>{c("Disable", "Devre dışı")}</button> : null}
      {status === "DISABLED" || status === "DEGRADED" ? <button type="button" disabled={Boolean(busy)} onClick={() => void execute("reopen")}><RotateCcw size={13}/>{c("Reopen", "Taslağa aç")}</button> : null}
    </div>
    {error ? <small>{error}</small> : null}
  </div>;
}
