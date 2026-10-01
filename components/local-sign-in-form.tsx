"use client";

import { ArrowRight, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
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

  return <form onSubmit={submit} className="local-auth-card">
    <div className="local-auth-head">
      <div className="auth-kicker"><KeyRound size={15}/> {tr ? "Yerel hesap" : "Local account"}</div>
      <span>{tr ? "E-posta veya kullanıcı adınız ve parolanızla giriş yapın" : "Sign in with your email or username and password"}</span>
    </div>

    <div className="auth-field">
      <label htmlFor="local-identifier">{tr ? "E-posta veya kullanıcı adı" : "Email or username"}</label>
      <div className="auth-input-shell">
        <Mail size={16} aria-hidden="true"/>
        <input
          id="local-identifier"
          autoComplete="username"
          maxLength={254}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder={tr ? "ad@firma.com veya kullanıcı adı" : "name@company.com or username"}
          required
        />
      </div>
    </div>

    <div className="auth-field">
      <label htmlFor="local-password">{tr ? "Parola" : "Password"}</label>
      <div className="auth-input-shell">
        <LockKeyhole size={16} aria-hidden="true"/>
        <input
          id="local-password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          minLength={12}
          maxLength={256}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={tr ? "Parolanızı girin" : "Enter your password"}
          required
        />
        <button
          type="button"
          className="auth-password-toggle"
          aria-label={showPassword ? (tr ? "Parolayı gizle" : "Hide password") : (tr ? "Parolayı göster" : "Show password")}
          onClick={() => setShowPassword((value) => !value)}
        >
          {showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}
        </button>
      </div>
    </div>

    <button type="submit" className="auth-primary auth-local-submit" disabled={busy}>
      <span className="auth-action-icon">{busy ? <LoaderCircle size={18}/> : <KeyRound size={18}/>}</span>
      <span>{tr ? "Yerel hesapla giriş yap" : "Sign in with local account"}</span>
      <ArrowRight size={18} className="auth-action-arrow"/>
    </button>

    {error ? <div className="auth-message error local-auth-error"><span>{error}</span></div> : null}
  </form>;
}
