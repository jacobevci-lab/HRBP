import { ConnectionStatus, IdentityProviderType, PlatformRole, Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { internalBearerAuthorized } from "@/lib/internal-auth";
import { runtimeBoolean, runtimeString } from "@/lib/runtime-env";
export * from "@/lib/scim-protocol.mjs";
import { normalizeScimDomain, SCIM_ERROR_SCHEMA } from "@/lib/scim-protocol.mjs";

type ScopeClient = PrismaClient | Prisma.TransactionClient;

const governedScimProviderTypes = [
  IdentityProviderType.ENTRA_ID,
  IdentityProviderType.OKTA,
  IdentityProviderType.OIDC
] as const;

export async function resolveGovernedScimPolicy(client: ScopeClient, tenantId: string) {
  const active = await client.identityProviderConnection.findMany({
    where: {
      tenantId,
      status: ConnectionStatus.ACTIVE,
      type: { in: [...governedScimProviderTypes] }
    },
    orderBy: { createdAt: "asc" },
    take: 2,
    select: { id: true, name: true, scimEnabled: true }
  });

  if (active.length === 0) return { managed: false as const };
  if (active.length !== 1) throw new Error("SCIM_PROVIDER_AMBIGUOUS");

  return {
    managed: true as const,
    providerId: active[0].id,
    providerName: active[0].name,
    scimEnabled: active[0].scimEnabled
  };
}

export function scimRuntimeConfig() {
  const enabled = runtimeBoolean("HRBP_SCIM_ENABLED", false);
  const tenantId = runtimeString("HRBP_AUTH_TENANT_ID") ?? "";
  const rawBaseUrl = runtimeString("APP_URL") ?? "";
  let baseUrl = "";
  try {
    const parsed = new URL(rawBaseUrl);
    if (["https:","http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash) baseUrl = parsed.origin;
  } catch {}
  const allowedDomains = (runtimeString("HRBP_ALLOWED_EMAIL_DOMAINS") ?? "")
    .split(",").map((value)=>normalizeScimDomain(value)).filter((value):value is string=>Boolean(value)).slice(0,50);
  const token = runtimeString("HRBP_SCIM_TOKEN") ?? "";
  const previousToken = runtimeString("HRBP_SCIM_TOKEN_PREVIOUS") ?? "";
  const previousExpiresAtRaw = runtimeString("HRBP_SCIM_TOKEN_PREVIOUS_EXPIRES_AT") ?? "";
  const allowUnmanagedAdoption = runtimeBoolean("HRBP_SCIM_ALLOW_UNMANAGED_ADOPTION", false);
  const tokenValid = token.length >= 32 && !/\s/.test(token);
  const previousTokenValid = Boolean(previousToken) && previousToken.length >= 32 && !/\s/.test(previousToken) && previousToken !== token;
  const previousExpiry = previousExpiresAtRaw ? new Date(previousExpiresAtRaw) : null;
  const previousExpiryValid = Boolean(previousExpiry && !Number.isNaN(previousExpiry.getTime()));
  const now = Date.now();
  const maxOverlapMs = 7 * 24 * 60 * 60 * 1000;
  const rotationOverlapActive = Boolean(
    previousTokenValid &&
    previousExpiryValid &&
    previousExpiry &&
    previousExpiry.getTime() > now &&
    previousExpiry.getTime() - now <= maxOverlapMs
  );
  const rotationExpired = Boolean(previousToken && previousExpiryValid && previousExpiry && previousExpiry.getTime() <= now);
  const rotationConfigurationValid = !previousToken || Boolean(
    previousTokenValid &&
    previousExpiryValid &&
    previousExpiry &&
    previousExpiry.getTime() - now <= maxOverlapMs
  );
  return {
    enabled, tenantId, baseUrl, allowedDomains, allowUnmanagedAdoption,
    rotationOverlapActive,
    rotationExpired,
    rotationConfigurationValid,
    rotationExpiresAt: previousExpiryValid && previousExpiry ? previousExpiry.toISOString() : null,
    configured: enabled && /^[A-Za-z0-9._-]{3,64}$/.test(tenantId) && allowedDomains.length > 0 && tokenValid
  };
}
export function scimHeaders(extra?:HeadersInit) {
  const headers=new Headers(extra);
  headers.set("content-type","application/scim+json; charset=utf-8");
  headers.set("cache-control","no-store");
  headers.set("x-content-type-options","nosniff");
  return headers;
}
export function scimJson(body:unknown,status=200,extra?:HeadersInit){return Response.json(body,{status,headers:scimHeaders(extra)});}
export function scimError(status:number,detail:string,scimType?:string,extra?:HeadersInit){
  return scimJson({schemas:[SCIM_ERROR_SCHEMA],status:String(status),...(scimType?{scimType}:{}),detail},status,extra);
}
export async function scimAccess(request:Request){
  const config=scimRuntimeConfig();
  let policy;
  try {
    policy = await resolveGovernedScimPolicy(db, config.tenantId);
  } catch {
    console.error("[HRBP] Governed SCIM runtime policy is unavailable.");
    return scimError(503,"SCIM provisioning policy is unavailable.");
  }

  const requestedEnabled = policy.managed ? policy.scimEnabled : config.enabled;
  if(!requestedEnabled) {
    return scimError(
      404,
      policy.managed
        ? "SCIM provisioning is disabled by the active governed identity provider."
        : "SCIM provisioning is disabled."
    );
  }
  if(!config.configured) return scimError(503,"SCIM provisioning is enabled by policy but its runtime configuration is not ready.");
  const currentAuthorized = internalBearerAuthorized(request,"HRBP_SCIM_TOKEN");
  const previousAuthorized = config.rotationOverlapActive &&
    internalBearerAuthorized(request,"HRBP_SCIM_TOKEN_PREVIOUS");
  if(!currentAuthorized && !previousAuthorized){
    return scimError(401,"Valid SCIM bearer credentials are required.",undefined,{"www-authenticate":'Bearer realm="HRBP SCIM"'});
  }
  return null;
}
export async function readScimObject(request:Request):Promise<Record<string,unknown>|null>{
  if(!request.body) return null;
  const contentType=request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if(contentType!=="application/scim+json"&&contentType!=="application/json") return null;
  const reader=request.body.getReader(); const decoder=new TextDecoder("utf-8",{fatal:true});
  let total=0,source="";
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>64*1024){await reader.cancel();return null;}source+=decoder.decode(value,{stream:true});}
    source+=decoder.decode(); const parsed:unknown=JSON.parse(source);
    return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null;
  }catch{return null;}finally{reader.releaseLock();}
}
export function defaultScimRole(){return PlatformRole.EMPLOYEE;}
export function provisioningSelect(){return {id:true,email:true,displayName:true,active:true,provisioningExternalId:true,provisionedAt:true,provisioningUpdatedAt:true} as const;}
export async function lockScimTenant(tx:Prisma.TransactionClient,tenantId:string){
  if(!/^[A-Za-z0-9._-]{3,64}$/.test(tenantId)) throw new Error("SCIM tenant identifier is invalid.");
  await tx.$queryRaw`WITH acquired AS (SELECT pg_advisory_xact_lock(hashtextextended(${tenantId},41792031::bigint))) SELECT 1::INTEGER AS "locked" FROM acquired`;
}
