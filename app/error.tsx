"use client";

import Link from "next/link";
import { CircleAlert, House, RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("HRBP application render failure", error);
  }, [error]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg)", color: "var(--text)" }}>
      <section className="card" style={{ width: "min(680px, 100%)", padding: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div className="enterprise-stat-icon"><CircleAlert size={19}/></div>
          <div style={{ flex: 1 }}>
            <div className="section-kicker">HRBP One recovery</div>
            <h2 style={{ margin: "4px 0 8px" }}>The current workspace could not be rendered.</h2>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6, fontSize: 11 }}>Retry the request. If the live data plane is unavailable, supported modules automatically switch to a safe staging view instead of taking down navigation.</p>
            {error.digest ? <p style={{ margin: "10px 0 0", color: "var(--muted-2)", fontSize: 9 }}>Diagnostic digest: {error.digest}</p> : null}
            <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
              <button className="create-button" type="button" onClick={() => reset()}><RotateCcw size={16}/> Retry</button>
              <Link className="secondary-button" href="/"><House size={15}/> Command Center</Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
