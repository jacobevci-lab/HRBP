import { GovernancePlanningModulePage } from "@/components/governance-planning-module-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EngagementPage() {
  return GovernancePlanningModulePage({ slug: "engagement" });
}
