"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", background: "#0b100f", color: "#e7efec", fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "min(680px, 100%)", padding: 28, borderRadius: 14, border: "1px solid #293632", background: "#111917", boxShadow: "0 18px 50px rgba(0,0,0,.28)" }}>
            <div style={{ textTransform: "uppercase", letterSpacing: 1.1, fontSize: 10, fontWeight: 800, color: "#6fbdae" }}>HRBP One recovery</div>
            <h1 style={{ fontSize: 24, margin: "8px 0 10px" }}>The application runtime hit an unexpected error.</h1>
            <p style={{ margin: 0, color: "#9ba9a5", lineHeight: 1.65, fontSize: 13 }}>The error is isolated at the application boundary. Retry the current version; if the runtime dependency remains unavailable, the diagnostic identifier below can be matched with Cloudflare logs.</p>
            {error.digest ? <p style={{ margin: "12px 0 0", color: "#70807b", fontSize: 11 }}>Diagnostic digest: {error.digest}</p> : null}
            <button type="button" onClick={() => reset()} style={{ marginTop: 20, height: 38, padding: "0 16px", borderRadius: 8, border: "1px solid #2d8d7e", background: "#1f6c60", color: "white", fontWeight: 700, cursor: "pointer" }}>Retry application</button>
          </section>
        </main>
      </body>
    </html>
  );
}
