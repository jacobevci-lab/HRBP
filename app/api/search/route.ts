import { EmploymentStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { navigation } from "@/lib/navigation";
import { getRequestContext } from "@/lib/request-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ data: [] });

  const normalized = q.toLowerCase();
  const moduleResults = navigation
    .flatMap((group) => group.items)
    .filter((item) => item.label.toLowerCase().includes(normalized) || item.slug.toLowerCase().includes(normalized))
    .slice(0, 8)
    .map((item) => ({
      type: "module" as const,
      id: item.slug,
      title: item.label,
      subtitle: "HRBP One workspace",
      href: item.slug === "dashboard" ? "/" : `/module/${item.slug}`
    }));

  const ctx = getRequestContext(request);
  if (!ctx) return Response.json({ data: moduleResults });

  try {
    const data = await withDb(async (db) => {
      const [people, positions] = await Promise.all([
        can(ctx, "people:read") ? db.person.findMany({
          where: {
            tenantId: ctx.tenantId,
            OR: [
              { givenName: { contains: q, mode: "insensitive" } },
              { familyName: { contains: q, mode: "insensitive" } },
              { employeeNumber: { contains: q, mode: "insensitive" } },
              { workEmail: { contains: q, mode: "insensitive" } }
            ]
          },
          orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
          take: 8,
          select: {
            id: true,
            givenName: true,
            familyName: true,
            employeeNumber: true,
            employments: {
              where: { status: { not: EmploymentStatus.TERMINATED } },
              orderBy: { startDate: "desc" },
              take: 1,
              select: { position: { select: { title: true } } }
            }
          }
        }) : Promise.resolve([]),
        can(ctx, "positions:read") ? db.position.findMany({
          where: {
            tenantId: ctx.tenantId,
            validTo: null,
            OR: [
              { positionCode: { contains: q, mode: "insensitive" } },
              { title: { contains: q, mode: "insensitive" } },
              { orgUnit: { name: { contains: q, mode: "insensitive" } } }
            ]
          },
          orderBy: { positionCode: "asc" },
          take: 8,
          select: { id: true, positionCode: true, title: true, orgUnit: { select: { name: true } } }
        }) : Promise.resolve([])
      ]);

      return [
        ...moduleResults,
        ...people.map((person) => ({
          type: "person" as const,
          id: person.id,
          title: `${person.givenName} ${person.familyName}`,
          subtitle: `${person.employeeNumber ?? "No employee ID"} · ${person.employments[0]?.position?.title ?? "Unassigned"}`,
          href: `/module/employee-360?person=${encodeURIComponent(person.id)}`
        })),
        ...positions.map((position) => ({
          type: "position" as const,
          id: position.id,
          title: position.title,
          subtitle: `${position.positionCode} · ${position.orgUnit.name}`,
          href: "/module/positions"
        }))
      ];
    });
    return Response.json({ data });
  } catch (error) {
    console.error("Global search live data failed", error);
    return Response.json({ data: moduleResults, degraded: true });
  }
}
