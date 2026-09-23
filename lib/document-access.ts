import { DataClassification, DocumentStatus, PlatformRole, Prisma, PrismaClient } from "@prisma/client";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

type ScopeClient = PrismaClient | Prisma.TransactionClient;

const documentWideRoles = new Set<PlatformRole>([
  PlatformRole.HR_OPERATIONS,
  PlatformRole.TENANT_ADMIN
]);

async function resolveDocumentEmploymentScope(client: ScopeClient, ctx: RequestContext): Promise<string[] | null> {
  if (documentWideRoles.has(ctx.role)) return null;
  // A generic personnel document repository is more sensitive than ordinary
  // workforce data. Managers can read their own employee documents, but direct
  // report access must be provided through purpose-specific workflows instead.
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

export async function documentVisibilityWhere(client: ScopeClient, ctx: RequestContext): Promise<Prisma.DocumentRecordWhereInput> {
  const personScope = await resolveDocumentPersonScope(client, ctx);
  return {
    tenantId: ctx.tenantId,
    status: { not: DocumentStatus.DELETED },
    classification: { not: DataClassification.HIGHLY_RESTRICTED },
    // Case evidence never falls back into the generic document repository even
    // if a record was accidentally assigned a weaker classification.
    caseId: null,
    ...(personScope === null ? {} : {
      OR: [
        { personId: null },
        { personId: { in: personScope } }
      ]
    })
  };
}

export async function getVisibleDocument(client: ScopeClient, ctx: RequestContext, documentId: string) {
  const where = await documentVisibilityWhere(client, ctx);
  return client.documentRecord.findFirst({ where: { ...where, id: documentId } });
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
