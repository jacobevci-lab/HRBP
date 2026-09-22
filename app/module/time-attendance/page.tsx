import { WorkPayModulePage } from "@/components/work-pay-module-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TimeAttendancePage() {
  return WorkPayModulePage({ slug: "time-attendance" });
}
