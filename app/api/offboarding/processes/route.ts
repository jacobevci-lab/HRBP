import { DataClassification, EmploymentStatus, ExitTaskStatus, SeparationStatus, SeparationType } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request); if (!ctx) return unauthorized(); if (!can(ctx,"offboarding:read")) return forbidden();
  const data = await db.separationProcess.findMany({ where:{tenantId:ctx.tenantId}, orderBy:[{lastWorkingDate:"asc"},{createdAt:"desc"}], include:{tasks:true,assets:true,accessRevocations:true,exitInterview:true,_count:{select:{knowledgeTransfers:true}}}, take:300 });
  return Response.json({data});
}

export async function POST(request: Request) {
  const ctx=getRequestContext(request); if(!ctx)return unauthorized(); if(!mutationOriginAllowed(request))return forbidden("Cross-origin mutation blocked."); if(!can(ctx,"offboarding:write"))return forbidden();
  const body=await request.json() as {employmentId?:string;type?:SeparationType;noticeDate?:string;lastWorkingDate?:string;reasonCode?:string;employeeReason?:string;managerEmploymentId?:string};
  if(!body.employmentId||!body.type||!Object.values(SeparationType).includes(body.type)||!body.lastWorkingDate)return Response.json({error:"employmentId, valid type and lastWorkingDate are required."},{status:400});
  const lastWorkingDate=new Date(body.lastWorkingDate); if(Number.isNaN(lastWorkingDate.getTime()))return Response.json({error:"lastWorkingDate is invalid."},{status:400});
  const data=await db.$transaction(async tx=>{
    const employment=await tx.employment.findFirst({where:{id:body.employmentId,tenantId:ctx.tenantId,status:{in:[EmploymentStatus.ACTIVE,EmploymentStatus.LEAVE,EmploymentStatus.SUSPENDED]}},select:{id:true,managerEmploymentId:true}}); if(!employment)throw new Error("NOT_FOUND");
    const existing=await tx.separationProcess.findFirst({where:{tenantId:ctx.tenantId,employmentId:employment.id,status:{notIn:[SeparationStatus.CLOSED,SeparationStatus.CANCELLED]}},select:{id:true}}); if(existing)throw new Error("EXISTS");
    const record=await tx.separationProcess.create({data:{tenantId:ctx.tenantId,employmentId:employment.id,type:body.type!,status:SeparationStatus.NOTICE_PERIOD,noticeDate:body.noticeDate?new Date(body.noticeDate):new Date(),lastWorkingDate,reasonCode:body.reasonCode,employeeReason:body.employeeReason,initiatedById:ctx.actorId,managerEmploymentId:body.managerEmploymentId??employment.managerEmploymentId,tasks:{create:[
      {tenantId:ctx.tenantId,domain:"HR",title:"Confirm separation documentation",status:ExitTaskStatus.NOT_STARTED,blocking:true,dueAt:lastWorkingDate},
      {tenantId:ctx.tenantId,domain:"MANAGER",title:"Complete knowledge transfer",status:ExitTaskStatus.NOT_STARTED,blocking:true,dueAt:lastWorkingDate},
      {tenantId:ctx.tenantId,domain:"IT",title:"Revoke logical access",status:ExitTaskStatus.NOT_STARTED,blocking:true,dueAt:lastWorkingDate},
      {tenantId:ctx.tenantId,domain:"FACILITIES",title:"Collect company assets",status:ExitTaskStatus.NOT_STARTED,blocking:true,dueAt:lastWorkingDate},
      {tenantId:ctx.tenantId,domain:"PAYROLL",title:"Validate final settlement",status:ExitTaskStatus.NOT_STARTED,blocking:true,dueAt:lastWorkingDate}
    ]}},include:{tasks:true}});
    await appendAudit(tx,ctx,{action:"offboarding.process-created",resourceType:"SeparationProcess",resourceId:record.id,classification:DataClassification.RESTRICTED}); return record;
  }).catch(e=>e instanceof Error&&["NOT_FOUND","EXISTS"].includes(e.message)?e.message:Promise.reject(e));
  if(data==="NOT_FOUND")return Response.json({error:"Active employment not found in tenant."},{status:404}); if(data==="EXISTS")return Response.json({error:"An open separation process already exists for this employment."},{status:409}); return Response.json({data},{status:201});
}
