import { AppShell } from "@/components/app-shell";
import { ModuleLanding } from "@/components/module-landing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ModulePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const query = typeof search.q === "string" ? search.q : "";
  const personId = typeof search.person === "string" ? search.person : undefined;
  const tab = typeof search.tab === "string" ? search.tab : undefined;

  return (
    <AppShell>
      <ModuleLanding slug={slug} query={query} personId={personId} tab={tab} />
    </AppShell>
  );
}
