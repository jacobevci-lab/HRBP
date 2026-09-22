export default function ModuleLoading() {
  return (
    <div aria-busy="true" aria-label="Loading HRBP workspace">
      <section className="page-heading module-heading">
        <div>
          <div style={{ width: 132, height: 9, borderRadius: 999, background: "#e9eeeb", marginBottom: 10 }}/>
          <div style={{ width: 230, height: 28, borderRadius: 8, background: "#e6ebe8", marginBottom: 10 }}/>
          <div style={{ width: "min(560px, 72vw)", height: 11, borderRadius: 999, background: "#edf1ef" }}/>
        </div>
      </section>
      <section className="enterprise-stats">
        {Array.from({ length: 4 }).map((_, index) => <div className="enterprise-stat" key={index}><div className="enterprise-stat-icon" style={{ background: "#eef2ef" }}/><div style={{ flex: 1 }}><span style={{ display: "block", width: 80, height: 8, borderRadius: 999, background: "#edf1ef" }}/><strong style={{ display: "block", width: 48, height: 20, borderRadius: 7, background: "#e5ebe7", marginTop: 7 }}/><small style={{ display: "block", width: 104, height: 7, borderRadius: 999, background: "#eff2f0", marginTop: 7 }}/></div></div>)}
      </section>
      <section className="card" style={{ minHeight: 320, padding: 16 }}>
        <div style={{ width: 180, height: 12, borderRadius: 999, background: "#e7ece9", marginBottom: 16 }}/>
        {Array.from({ length: 6 }).map((_, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr .8fr", gap: 16, padding: "14px 0", borderBottom: "1px solid #eef1ef" }}><span style={{ height: 9, borderRadius: 999, background: "#e8edea" }}/><span style={{ height: 9, borderRadius: 999, background: "#edf1ef" }}/><span style={{ height: 9, borderRadius: 999, background: "#edf1ef" }}/><span style={{ height: 9, borderRadius: 999, background: "#f0f3f1" }}/></div>)}
      </section>
    </div>
  );
}
