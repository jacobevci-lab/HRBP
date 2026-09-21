import { DataClassification, EmploymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";
import { recordAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "people:read")) return forbidden();

  const people = await db.person.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    take: 200,
    select: {
      id: true, employeeNumber: true, givenName: true, familyName: true, workEmail: true, classification: true,
      employments: { where: { status: { not: EmploymentStatus.TERMINATED } }, take: 1, select: {
        id: true, status: true, startDate: true,
        position: { select: { id: true, positionCode: true, title: true, orgUnit: { select: { id: true, name: true } } } }
      }}
    }
  });
  return Response.json({ data: people });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "people:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const givenName = String(body.givenName ?? "").trim();
  const familyName = String(body.familyName ?? "").trim();
  const employeeNumber = String(body.employeeNumber ?? "").trim();
  const workEmail = String(body.workEmail ?? "").trim() || null;
  const positionId = String(body.positionId ?? "").trim() || null;
  if (!givenName || !familyName || !employeeNumber) return Response.json({ error: "givenName, familyName and employeeNumber are required." }, { status: 400 });

  const person = await db.person.create({ data: {
    tenantId: ctx.tenantId, givenName, familyName, employeeNumber, workEmail,
    classification: DataClassification.CONFIDENTIAL,
    employments: { create: { tenantId: ctx.tenantId, status: EmploymentStatus.ACTIVE, startDate: new Date(), positionId } }
  }});
  await recordAudit({ ctx, action: "PERSON_CREATED", resourceType: "Person", resourceId: person.id, classification: DataClassification.CONFIDENTIAL });
  return Response.json({ data: person }, { status: 201 });
}
