import { FilePenLine, ShieldCheck } from "lucide-react";
import { WorkforceScenarioStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

function formatDate(value: Date, locale: "en" | "tr") {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Istanbul"
  }).format(value);
}

export async function WorkforcePlanningOwnedDrafts() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx || !can(ctx, "workforce-plan:read")) return null;

  const drafts = await withDb((db) => db.workforceScenario.findMany({
    where: {
      tenantId: ctx.tenantId,
      ownerId: ctx.actorId,
      status: { in: [WorkforceScenarioStatus.DRAFT, WorkforceScenarioStatus.REVIEW] },
      lines: { none: {} }
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      baseDate: true,
      horizonMonths: true,
      currency: true,
      updatedAt: true
    }
  }));

  if (!drafts.length) return null;
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;

  return <section className="card gov-panel" style={{ marginTop: 14 }}>
    <div className="gov-panel-head">
      <div><span className="section-kicker">{c("Owner-safe workspace", "Sahip-güvenli çalışma alanı")}</span><h3>{c("My empty planning drafts", "Boş planlama taslaklarım")}</h3></div>
      <FilePenLine size={18}/>
    </div>
    <p className="gov-copy">{c(
      "Drafts you own remain visible before their first scoped planning line is added. FTE and cost aggregates stay hidden here so ownership never bypasses organization or position scope.",
      "Sahibi olduğunuz taslaklar ilk kapsamlı plan satırı eklenmeden önce de görünür kalır. Sahiplik organizasyon veya pozisyon kapsamını aşmasın diye FTE ve maliyet toplamları burada gösterilmez."
    )}</p>
    <div className="gov-table-wrap"><table className="gov-table">
      <thead><tr><th>{c("Scenario", "Senaryo")}</th><th>{c("Status", "Durum")}</th><th>{c("Base date", "Baz tarih")}</th><th>{c("Horizon", "Ufuk")}</th><th>{c("Currency", "Para birimi")}</th><th>{c("Updated", "Güncellendi")}</th><th>{c("Data boundary", "Veri sınırı")}</th></tr></thead>
      <tbody>{drafts.map((draft) => <tr key={draft.id}>
        <td><strong>{draft.name}</strong><small className="cell-sub">{draft.code}</small></td>
        <td><em className={`gov-pill ${draft.status.toLowerCase()}`}>{draft.status}</em></td>
        <td>{formatDate(draft.baseDate, locale)}</td>
        <td>{draft.horizonMonths}m</td>
        <td>{draft.currency}</td>
        <td>{formatDate(draft.updatedAt, locale)}</td>
        <td><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ShieldCheck size={14}/>{c("No unscoped FTE / cost", "Kapsam dışı FTE / maliyet yok")}</span></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
