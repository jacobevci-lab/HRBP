import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const roles=Object.fromEntries(['EMPLOYEE','MANAGER','HR_OPERATIONS','TENANT_ADMIN'].map(x=>[x,x]));
function load(path,mocks={}) {
 const js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};
 new Function('module','exports','require',js)(m,m.exports,n=>n in mocks?mocks[n]:n.startsWith('@/')?load(n.slice(2)+'.ts',mocks):require(n));
 return m.exports;
}
const auth=load('lib/auth-session.ts',{'@prisma/client':{PlatformRole:roles},'@/lib/runtime-env':{runtimeString:()=> 'audit-only-session-key-with-32-characters',runtimeNumber:(_k,v)=>v}});
const passwords=load('lib/local-auth.ts');
const seed=ts.createSourceFile('seed.mjs',readFileSync('scripts/seed-staging.mjs','utf8'),ts.ScriptTarget.Latest,true);
const hashFunction=seed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='hashSeedPassword');
const {randomBytes,scryptSync}=require('node:crypto');
const hashSeed=new Function('randomBytes','scryptSync',hashFunction.getText(seed)+';return hashSeedPassword;')(randomBytes,scryptSync);
test('staging seed produces a password accepted by the actual local verifier',()=>assert.equal(passwords.verifyLocalPassword('synthetic-audit-password',hashSeed('synthetic-audit-password')),true));
test('incorrect password is rejected by seed-generated hash',()=>assert.equal(passwords.verifyLocalPassword('different-audit-password',hashSeed('synthetic-audit-password')),false));
for(const path of ['//evil.example','/\\evil.example','/\n/evil.example','https://evil.example','/%5cevil.example','/%2f%2fevil.example','/%0aevil','/%ZZ']) test('returnTo rejects unsafe path '+JSON.stringify(path),()=>assert.equal(auth.sanitizeReturnTo(path),'/'));
for(const path of ['/','/module/people','/module/employee-360?person=abc%2Fdef#history','/module/people?q=%C4%B0pek']) test('returnTo preserves relative application URL '+path,()=>assert.equal(auth.sanitizeReturnTo(path),path));
test('malformed cookie encoding fails closed instead of throwing',()=>assert.doesNotThrow(()=>auth.parseCookies('hrbp_session=%ZZ; other=valid')));
test('duplicate session cookies are rejected rather than first/last wins',()=>assert.equal(auth.parseCookies('hrbp_session=a; hrbp_session=b').hrbp_session,''));
const secret='synthetic-test-key-with-32-characters';
for(const exp of [undefined,0,-1,'9999999999',null]) test('signed payload needs a numeric unexpired expiry '+JSON.stringify(exp),()=>assert.equal(auth.decodeSignedPayload(auth.encodeSignedPayload({v:1,exp},secret),secret),null));
test('signed payload rejects appended token segments',()=>assert.equal(auth.decodeSignedPayload(auth.encodeSignedPayload({exp:9999999999},secret)+'.extra',secret),null));
test('signed payload valid roundtrip',()=>assert.deepEqual(auth.decodeSignedPayload(auth.encodeSignedPayload({v:1,exp:9999999999},secret),secret),{v:1,exp:9999999999}));
test('every navigation capability is included in session capability projection',()=>{
 const nav=readFileSync('lib/navigation.ts','utf8'); const session=readFileSync('app/api/auth/session/route.ts','utf8').split('const uiCapabilityCandidates')[1].split('];')[0];
 for(const m of nav.matchAll(/requiredCapability:\s*"([^"]+)"/g)) assert.ok(session.includes('"'+m[1]+'"'),`missing session projection: ${m[1]}`);
});
const {readJsonObject}=load('lib/input-validation.ts');
for(const body of ['{','null','[]','42','"text"']) test('JSON object parser rejects '+body,async()=>assert.equal(await readJsonObject(new Request('https://local.test',{method:'POST',body})),null));
test('JSON object parser preserves valid input',async()=>assert.deepEqual(await readJsonObject(new Request('https://local.test',{method:'POST',body:'{"x":1}'})),{x:1}));
