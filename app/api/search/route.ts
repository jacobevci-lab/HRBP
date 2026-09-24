import { EmploymentStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import { isLocale, translate, type Locale } from "@/lib/i18n";
import { navigation } from "@/lib/navigation";
import { getRequestContext } from "@/lib/request-context";

export const dynamic = "force-dynamic";

function requestLocale(request: Request): Locale {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)hrbp-locale=([^;]+)/);
  const value = match ? decodeURIComponent(match[1]) : null;
  return isLocale(value) ? value : "en";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return Response.json({ data: [] }, { headers: { "cache-control": "no-store" } });

  const locale = requestLocale(request);
  const normalized = q.toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US");
  const ctx = getRequestContext(request);
  const moduleResults = navigation
    .flatMap((group) => group.items)
    .filter((item) => {
      if (!ctx) return !item.requiredCapability && !item.requiresAuthentication;
      if (item.requiredCapability) return can(ctx, item.requiredCapability);
      return true;
    })
    .filter((item) => {
      const enLabel = translate("en", item.labelKey).toLocaleLowerCase("en-US");
      const trLabel = translate("tr", item.labelKey).toLocaleLowerCase("tr-TR");
      return enLabel.includes(normalized) || trLabel.includes(normalized) || item.slug.toLowerCase().includes(normalized);
    })
    .slice(0, 8)
    .map((item) => ({
      type: "module" as const,
      id: item.slug,
      title: translate(locale, item.labelKey),
      subtitle: locale === "tr" ? "HRBP One çalışma alanı" : "HRBP One workspace",
      href: item.slug === "dashboard" ? "/" : `/module/${item.slug}`
    }));

  if (!ctx) return Response.json({ data: moduleResults }, { headers: { "cache-control": "no-store" } });

  try {
    const data = await withDb(async (db) => {
      const canReadPeople = can(ctx, "people:read");
      const peopleScope = canReadPeople ? await resolveEmploymentScope(db, ctx) : [];
      const personScopeFilter = peopleScope === null
        ? {}
        : {
            employments: {
              some: {
                tenantId: ctx.tenantId,
                id: { in: peopleScope },
                status: { not: EmploymentStatus.TERMINATED }
              }
            }
          };
      const employmentScopeFilter = peopleScope === null ? {} : { id: { in: peopleScope } };

      const [people, positions] = await Promise.all([
        canReadPeople ? db.person.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...personScopeFilter,
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
              where: {
                tenantId: ctx.tenantId,
                status: { not: EmploymentStatus.TERMINATED },
                ...employmentScopeFilter
              },
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
          subtitle: `${person.employeeNumber ?? (locale === "tr" ? "Çalışan ID yok" : "No employee ID")} · ${person.employments[0]?.position?.title ?? (locale === "tr" ? "Atanmamış" : "Unassigned")}`,
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
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Global search live data failed", error);
    return Response.json({ data: moduleResults, degraded: true }, { headers: { "cache-control": "no-store" } });
  }
}
