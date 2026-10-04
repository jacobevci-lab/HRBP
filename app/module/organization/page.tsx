import { CircleCheckBig } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PublicCoreLanding } from "@/components/public-core-landing";
import { can } from "@/lib/authorization";
import { coreWorkspaceCopy } from "@/lib/core-workspace-copy";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrganizationPage() {
  const ctx = await getServerRequestContext();
  if (!ctx) return <AppShell><PublicCoreLanding slug="organization"/></AppShell>;
  const locale = await getServerLocale();
  const { title, description } = coreWorkspaceCopy("organization", locale);
  const { CoreHRLiveWorkspace } = await import("@/components/core-hr-live-workspace");
  const content = await CoreHRLiveWorkspace({ slug: "organization" });
  return <AppShell>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{description}</p></div>
      <div className="module-heading-actions">{can(ctx, "organization:read") ? <span className="secondary-button"><CircleCheckBig size={16}/>{locale === "tr" ? "Canlı veri görünümü" : "Live data view"}</span> : null}</div>
    </section>
    {content}
  </AppShell>;
}
