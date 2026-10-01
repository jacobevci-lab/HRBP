"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useState } from "react";

export function LocalSignInForm({
  returnTo,
  locale
}: {
  returnTo: string;
  locale: "en" | "tr";
}) {
  const tr = locale === "tr";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password, returnTo })
      });
      const value = await response.json() as { data?: { authenticated: boolean; returnTo: string }; error?: string };
      if (!response.ok || !value.data?.authenticated) {
        setError(value.error || (tr ? "Yerel giriş başarısız." : "Local sign-in failed."));
        return;
      }
      window.location.assign(value.data.returnTo || "/");
    } catch {
      setError(tr ? "Yerel giriş servisine ulaşılamadı." : "Local sign-in service could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
    <div className="auth-kicker"><KeyRound size={15}/> {tr ? "Yerel hesap" : "Local account"}</div>
    <label>
      <small>{tr ? "E-posta veya kullanıcı adı" : "Email or username"}</small>
      <input
        autoComplete="username"
        maxLength={254}
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        required
      />
    </label>
    <label>
      <small>{tr ? "Parola" : "Password"}</small>
      <input
        type="password"
        autoComplete="current-password"
        minLength={12}
        maxLength={256}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
    </label>
    <button type="submit" className="auth-primary" disabled={busy}>
      {busy ? <LoaderCircle size={17}/> : <KeyRound size={17}/>}
      {tr ? "Yerel hesapla giriş yap" : "Sign in with local account"}
    </button>
    {error ? <div className="auth-message error"><span>{error}</span></div> : null}
  </form>;
}
