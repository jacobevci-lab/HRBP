import { AppShell } from "@/components/app-shell";
import { RoleAwareHome } from "@/components/role-aware-home";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Home() {
  return <AppShell><RoleAwareHome/></AppShell>;
}
