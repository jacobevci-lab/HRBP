import { DataClassification, DocumentStatus, PlatformRole, Prisma, PrismaClient } from "@prisma/client";
import { canReadClassification } from "@/lib/authorization";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

type ScopeClient = PrismaClient | Prisma.TransactionClient;

type VisibilityOptions = {
  grantPermissions?: string[];
};

const documentWideRoles = new Set<PlatformRole>([
  PlatformRole.HR_OPERATIONS,
  PlatformRole.TENANT_ADMIN
]);

async function resolveDocumentEmploymentScope(client: ScopeClient, ctx: RequestContext): Promise<string[] | null> {
  if (documentWideRoles.has(ctx.role)) return null;
  if (ctx.role === PlatformRole.MANAGER) return ctx.employmentId ? [ctx.employmentId] : [];
  return resolveEmploymentScope(client, ctx);
}

export async function resolveDocumentPersonScope(client: ScopeClient, ctx: RequestContext): Promise<string[] | null> {
  const employmentScope = await resolveDocumentEmploymentScope(client, ctx);
  if (employmentScope === null) return null;
  if (!employmentScope.length) return [];
  const rows = await client.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: employmentScope } },
    select: { personId: true }
  });
  return [...new Set(rows.map((row) => row.personId))];
}

async function explicitDocumentGrantIds(client: ScopeClient, ctx: RequestContext, permissions: string[]) {
  if (!permissions.length) return [] as string[];
  const now = new Date();
  const principalFilters: Prisma.DocumentAccessGrantWhereInput[] = [
    { principalType: "USER", principalId: ctx.actorId }
  ];
  if (ctx.employmentId) principalFilters.push({ principalType: "EMPLOYMENT", principalId: ctx.employmentId });

  const grants = await client.documentAccessGrant.findMany({
    where: {
      tenantId: ctx.tenantId,
      permission: { in: permissions },
      OR: principalFilters,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }]
    },
    select: { documentId: true }
  });
  return [...new Set(grants.map((grant) => grant.documentId))];
}

export async function documentVisibilityWhere(
  client: ScopeClient,
  ctx: RequestContext,
  options: VisibilityOptions = {}
): Promise<Prisma.DocumentRecordWhereInput> {
  const personScope = await resolveDocumentPersonScope(client, ctx);
  const grantedDocumentIds = await explicitDocumentGrantIds(
    client,
    ctx,
    options.grantPermissions ?? ["READ", "DOWNLOAD", "SIGN"]
  );
  const classificationFilter = canReadClassification(ctx, DataClassification.HIGHLY_RESTRICTED)
    ? {}
    : { classification: { not: DataClassification.HIGHLY_RESTRICTED } };

  const base: Prisma.DocumentRecordWhereInput = {
    tenantId: ctx.tenantId,
    status: { not: DocumentStatus.DELETED },
    caseId: null,
    ...classificationFilter
  };

  if (personScope === null) return base;

  const visibility: Prisma.DocumentRecordWhereInput[] = [
    { personId: null },
    ...(personScope.length ? [{ personId: { in: personScope } }] : []),
    ...(grantedDocumentIds.length ? [{ id: { in: grantedDocumentIds } }] : [])
  ];

  return { ...base, OR: visibility };
}

export async function getVisibleDocument(client: ScopeClient, ctx: RequestContext, documentId: string) {
  const where = await documentVisibilityWhere(client, ctx);
  return client.documentRecord.findFirst({ where: { AND: [where, { id: documentId }] } });
}

export async function getDownloadableDocument(client: ScopeClient, ctx: RequestContext, documentId: string) {
  const where = await documentVisibilityWhere(client, ctx, { grantPermissions: ["DOWNLOAD"] });
  return client.documentRecord.findFirst({ where: { AND: [where, { id: documentId }] } });
}

export async function canWriteDocumentForPerson(client: ScopeClient, ctx: RequestContext, personId: string | null) {
  if (!personId) return true;
  const person = await client.person.findFirst({ where: { id: personId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!person) return false;
  const personScope = await resolveDocumentPersonScope(client, ctx);
  return personScope === null || personScope.includes(personId);
}

export async function employmentPrincipalsWithinScope(client: ScopeClient, ctx: RequestContext, employmentIds: string[]) {
  const ids = [...new Set(employmentIds.filter(Boolean))];
  if (!ids.length) return true;
  const valid = await client.employment.findMany({
    where: { tenantId: ctx.tenantId, id: { in: ids } },
    select: { id: true }
  });
  if (valid.length !== ids.length) return false;
  const scope = await resolveEmploymentScope(client, ctx);
  return scope === null || ids.every((id) => scope.includes(id));
}
