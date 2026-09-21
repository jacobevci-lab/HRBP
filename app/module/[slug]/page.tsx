import { AppShell } from "@/components/app-shell";
import { ModuleLanding } from "@/components/module-landing";

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AppShell>
      <ModuleLanding slug={slug} />
    </AppShell>
  );
}
