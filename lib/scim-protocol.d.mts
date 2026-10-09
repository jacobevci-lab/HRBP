export const SCIM_USER_SCHEMA: string;
export const SCIM_GROUP_SCHEMA: string;
export const SCIM_LIST_SCHEMA: string;
export const SCIM_ERROR_SCHEMA: string;
export const SCIM_PATCH_SCHEMA: string;
export type ScimUserInput={userName:string;displayName:string;externalId:string|null;active:boolean};
export type MutableScimUser={userName:unknown;displayName:unknown;externalId:unknown;active:unknown};
export function normalizeScimEmail(value:unknown):string|null;
export function normalizeScimDomain(value:unknown):string|null;
export function scimEmailAllowed(email:string,allowedDomains:string[]):boolean;
export function parseScimUserInput(body:Record<string,unknown>,current?:{email:string|null;displayName:string;active:boolean;provisioningExternalId:string|null}):ScimUserInput|null;
export function scimSubject(externalId:string|null,email:string):string;
export function parseScimFilter(value:string|null):{kind:"none"}|{kind:"userName";value:string}|{kind:"externalId";value:string}|null;
export function parsePagination(url:URL):{startIndex:number;count:number}|null;
export function validScimId(value:string):boolean;
export function applyScimPatch(body:Record<string,unknown>,current:MutableScimUser):MutableScimUser|null;
export function scimUserProjection(user:{id:string;email:string|null;displayName:string;active:boolean;provisioningExternalId:string|null;provisionedAt:Date|null;provisioningUpdatedAt:Date|null},baseUrl:string):Record<string,unknown>;
export function scimUserResourceType(baseUrl:string):Record<string,unknown>;
export function scimUserSchemaDefinition():Record<string,unknown>;

export type ScimGroupInput={displayName:string;externalId:string|null;members:string[]};
export type MutableScimGroup={displayName:unknown;externalId:unknown;members:string[]};
export function parseScimGroupFilter(value:string|null):{kind:"none"}|{kind:"displayName";value:string}|{kind:"externalId";value:string}|null;
export function parseScimGroupMembers(value:unknown):string[]|null;
export function parseScimGroupInput(body:Record<string,unknown>,current?:{displayName:string;externalId:string|null;members:string[]}):ScimGroupInput|null;
export function applyScimGroupPatch(body:Record<string,unknown>,current:{displayName:string;externalId:string|null;members:string[]}):MutableScimGroup|null;
export function scimGroupProjection(
  group:{id:string;externalId:string|null;displayName:string;createdAt:Date;updatedAt:Date},
  members:Array<{id:string;displayName:string}>,
  baseUrl:string
):Record<string,unknown>;
export function scimGroupResourceType(baseUrl:string):Record<string,unknown>;
export function scimGroupSchemaDefinition():Record<string,unknown>;
