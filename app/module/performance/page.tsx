import { GrowthModulePage } from "@/components/growth-module-page";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function PerformancePage(){return GrowthModulePage({slug:"performance"})}
