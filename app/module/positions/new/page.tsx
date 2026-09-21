import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PositionCreateForm, type OrganizationOption } from "@/components/position-create-form";
import { withDb } from "@/lib/db";
import { workspaceTenantId } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function typeLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export default async function NewPositionPage() {
  const organizations = await withDb(async (db) => {
    const rows = await db.organizationUnit.findMany({
      where: { tenantId: workspaceTenantId(), validTo: null },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, type: true }
    });
    return rows.map<OrganizationOption>((org) => ({ id: org.id, code: org.code, name: org.name, type: typeLabel(org.type) }));
  });

  return <AppShell><div className="record-form-page">
    <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / Positions / Create</div><h1>Create position</h1><p>Create a governed, budgetable seat before assigning or recruiting an incumbent.</p></div><div className="module-heading-actions"><Link className="secondary-button" href="/module/positions"><ChevronLeft size={15}/> Positions</Link><Link className="secondary-button" href="/auth/sign-in?returnTo=%2Fmodule%2Fpositions%2Fnew"><ShieldCheck size={15}/> Sign in</Link></div></section>
    <PositionCreateForm organizations={organizations}/>
  </div></AppShell>;
}
