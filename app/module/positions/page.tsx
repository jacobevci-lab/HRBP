import Link from "next/link";
import { CircleCheckBig, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PublicCoreLanding } from "@/components/public-core-landing";
import { can } from "@/lib/authorization";
import { coreWorkspaceCopy } from "@/lib/core-workspace-copy";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PositionsPage() {
  const ctx = await getServerRequestContext();
  if (!ctx) return <AppShell><PublicCoreLanding slug="positions"/></AppShell>;
  const locale = await getServerLocale();
  const { title, description } = coreWorkspaceCopy("positions", locale);
  const { CoreHRLiveWorkspace } = await import("@/components/core-hr-live-workspace");
  const content = await CoreHRLiveWorkspace({ slug: "positions" });
  const readable = can(ctx, "positions:read");
  return <AppShell>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{description}</p></div>
      <div className="module-heading-actions">
        {readable ? <span className="secondary-button"><CircleCheckBig size={16}/>{locale === "tr" ? "Canlı veri görünümü" : "Live data view"}</span> : null}
        {readable && can(ctx, "positions:write") ? <Link className="create-button" href="/module/positions/new"><Plus size={17}/>{locale === "tr" ? "Yeni pozisyon" : "New position"}</Link> : null}
      </div>
    </section>
    {content}
  </AppShell>;
}
