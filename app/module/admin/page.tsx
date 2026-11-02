import { AppShell } from "@/components/app-shell";
import { AdminStudio } from "@/components/admin-studio";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminStudioPage() {
  return <AppShell><AdminStudio/></AppShell>;
}
