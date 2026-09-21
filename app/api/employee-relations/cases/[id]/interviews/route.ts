import { DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getCaseWallCase } from "@/lib/case-wall";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request); if (!ctx) return unauthorized(); if (!can(ctx,"cases:read")) return forbidden();
  const { id } = await params; if (!await getCaseWallCase(ctx,id)) return forbidden("Case wall denies access to this matter.");
  const data = await db.caseInterview.findMany({ where:{tenantId:ctx.tenantId,caseId:id}, orderBy:[{scheduledAt:"asc"},{createdAt:"asc"}] });
  return Response.json({data});
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx=getRequestContext(request); if(!ctx)return unauthorized(); if(!can(ctx,"cases:write"))return forbidden();
  const {id}=await params; if(!await getCaseWallCase(ctx,id))return forbidden("Case wall denies access to this matter.");
  const body=await request.json() as {participantId?:string;scheduledAt?:string;summary?:string;transcriptDocumentId?:string};
  if(!body.scheduledAt && !body.summary?.trim()) return Response.json({error:"scheduledAt or summary is required."},{status:400});
  const data=await db.$transaction(async tx=>{const record=await tx.caseInterview.create({data:{tenantId:ctx.tenantId,caseId:id,participantId:body.participantId,interviewerId:ctx.actorId,scheduledAt:body.scheduledAt?new Date(body.scheduledAt):undefined,completedAt:body.summary?.trim()?new Date():undefined,summary:body.summary?.trim(),transcriptDocumentId:body.transcriptDocumentId}});await appendAudit(tx,ctx,{action:"employee-case.interview-recorded",resourceType:"CaseInterview",resourceId:record.id,classification:DataClassification.HIGHLY_RESTRICTED});return record});
  return Response.json({data},{status:201});
}
