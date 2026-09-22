"use client";

import Link from "next/link";
import { CircleAlert, House, RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function ModuleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("HRBP module render failure", error);
  }, [error]);

  return (
    <section className="card" style={{ maxWidth: 760, margin: "48px auto", padding: 28 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div className="enterprise-stat-icon" style={{ flex: "0 0 auto" }}><CircleAlert size={19}/></div>
        <div style={{ flex: 1 }}>
          <div className="section-kicker">Workspace recovery</div>
          <h2 style={{ margin: "4px 0 8px" }}>This module could not load its live data.</h2>
          <p style={{ margin: 0, color: "#6f7b77", lineHeight: 1.6, fontSize: 11 }}>HRBP kept the application shell available. Retry the workspace, or return to the Command Center while the data path is checked.</p>
          {error.digest ? <p style={{ margin: "10px 0 0", color: "#8a9490", fontSize: 9 }}>Diagnostic digest: {error.digest}</p> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            <button className="create-button" type="button" onClick={() => reset()}><RotateCcw size={16}/> Retry module</button>
            <Link className="secondary-button" href="/"><House size={16}/> Command Center</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
