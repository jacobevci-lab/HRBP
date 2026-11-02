import { AppShell } from "@/components/app-shell";
import { EmployeeHome } from "@/components/employee-home";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function EmployeeHomePage() {
  return <AppShell><EmployeeHome/></AppShell>;
}
