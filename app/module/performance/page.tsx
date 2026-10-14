import { GrowthModulePage } from "@/components/growth-module-page";
import { pickGrowthFocus, type GrowthSearchParams } from "@/lib/growth-route-focus";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PerformancePage({ searchParams }: { searchParams: GrowthSearchParams }) {
  return GrowthModulePage({ slug: "performance", focusId: pickGrowthFocus("performance", await searchParams) });
}
