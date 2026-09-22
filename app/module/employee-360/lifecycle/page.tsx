import Link from "next/link";
import { CircleAlert, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { can } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EmployeeLifecyclePage({ searchParams }: { searchParams: SearchParams }) {
  const search = await searchParams;
  const personId = typeof search.person === "string" ? search.person : "";
  const ctx = await getServerRequestContext();

  if (!ctx) {
    return <AppShell><section className="page-heading"><div><div className="eyebrow">HRBP One / Employee lifecycle</div><h1>Lifecycle command</h1><p>Governed employee movement and separation controls.</p></div></section><section className="card employee-restricted-card"><ShieldCheck size={22}/><div><h3>Authentication required</h3><p>Employee lifecycle mutations are not available on the public staging surface.</p><Link className="secondary-button" style={{ marginTop: 12 }} href={`/auth/sign-in?returnTo=${encodeURIComponent(`/module/employee-360/lifecycle?person=${personId}`)}`}>Sign in with enterprise SSO</Link></div></section></AppShell>;
  }

  if (!personId || !can(ctx, "people:read")) {
    return <AppShell><section className="page-heading"><div><div className="eyebrow">HRBP One / Employee lifecycle</div><h1>Lifecycle command</h1><p>Select an employee from the People directory before initiating a governed change.</p></div></section><section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>No authorized employee context</h3><p>Open an employee record first, then return to lifecycle actions.</p><Link className="secondary-button" href="/module/people">Open People</Link></div></section></AppShell>;
  }

  try {
    const { getEmployee360Data } = await import("@/lib/core-hr-live-data");
    const person = await getEmployee360Data(personId, { tenantId: ctx.tenantId });
    if (!person) throw new Error("PERSON_NOT_FOUND");
    const { EmployeeLifecycleConsole } = await import("@/components/employee-lifecycle-console");
    const canMove = can(ctx, "people:write") && can(ctx, "positions:write");
    const canOffboard = can(ctx, "offboarding:write");

    return <AppShell>
      <section className="page-heading module-heading">
        <div><div className="eyebrow">HRBP One / Employee 360 / Lifecycle</div><h1>Lifecycle command</h1><p>Execute controlled employee movement without bypassing position, audit, privacy or separation controls.</p></div>
        <div className="module-heading-actions"><Link className="secondary-button" href={`/module/employee-360?person=${encodeURIComponent(person.id)}&tab=employment`}>Back to Employee 360</Link></div>
      </section>
      <EmployeeLifecycleConsole personId={person.id} employeeName={person.name} currentPosition={person.position} currentDepartment={person.department} canMove={canMove} canOffboard={canOffboard}/>
    </AppShell>;
  } catch (error) {
    console.error("[HRBP] Employee lifecycle command failed to initialize.", error);
    return <AppShell><section className="page-heading"><div><div className="eyebrow">HRBP One / Employee lifecycle</div><h1>Lifecycle command</h1><p>Governed employee movement and separation controls.</p></div></section><section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>Lifecycle data is temporarily unavailable</h3><p>The employee data plane could not initialize. No mutation was attempted.</p><Link className="secondary-button" href={`/module/employee-360?person=${encodeURIComponent(personId)}`}>Return to Employee 360</Link></div></section></AppShell>;
  }
}
