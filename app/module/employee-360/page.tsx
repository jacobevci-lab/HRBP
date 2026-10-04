import Link from "next/link";
import { CircleCheckBig, Workflow } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PublicCoreLanding } from "@/components/public-core-landing";
import { can } from "@/lib/authorization";
import { coreWorkspaceCopy } from "@/lib/core-workspace-copy";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Employee360Page({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getServerRequestContext();
  if (!ctx) return <AppShell><PublicCoreLanding slug="employee-360"/></AppShell>;
  const locale = await getServerLocale();
  const { title, description } = coreWorkspaceCopy("employee-360", locale);
  const search = await searchParams;
  const personId = typeof search.person === "string" ? search.person : undefined;
  const tab = typeof search.tab === "string" ? search.tab : undefined;
  const { CoreHRLiveWorkspace } = await import("@/components/core-hr-live-workspace");
  const content = await CoreHRLiveWorkspace({ slug: "employee-360", personId, tab });
  const readable = can(ctx, "people:read");
  return <AppShell>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{description}</p></div>
      <div className="module-heading-actions">
        {readable ? <span className="secondary-button"><CircleCheckBig size={16}/>{locale === "tr" ? "Canlı veri görünümü" : "Live data view"}</span> : null}
        {personId && readable ? <Link className="create-button" href={`/module/employee-360/lifecycle?person=${encodeURIComponent(personId)}`}><Workflow size={16}/>{locale === "tr" ? "Yaşam döngüsü işlemleri" : "Lifecycle actions"}</Link> : null}
        <Link className="secondary-button" href="/module/people">{locale === "tr" ? "Çalışan dizini" : "People directory"}</Link>
      </div>
    </section>
    {content}
  </AppShell>;
}
