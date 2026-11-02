import { PlatformRole } from "@prisma/client";
import { Dashboard } from "@/components/dashboard";
import { EmployeeHome } from "@/components/employee-home";
import { HROperationsHub } from "@/components/hr-operations-hub";
import { ManagerHub } from "@/components/manager-hub";
import { getServerRequestContext } from "@/lib/server-session";

export async function RoleAwareHome() {
  const ctx = await getServerRequestContext();
  if (!ctx) return <Dashboard/>;
  if (ctx.role === PlatformRole.EMPLOYEE) return <EmployeeHome/>;
  if (ctx.role === PlatformRole.MANAGER) return <ManagerHub/>;
  if (ctx.role === PlatformRole.HR_OPERATIONS) return <HROperationsHub/>;
  return <Dashboard/>;
}
