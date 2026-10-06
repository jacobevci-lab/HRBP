import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { getBuildRevision } from './build-revision.cjs';
import { runtimeHealth, normalizedRevision } from '../lib/runtime-health.mjs';
import { deploymentConfig, verifyDeployment, deploymentSummary } from './verify-deployment.mjs';

const SHA = 'a'.repeat(40), OTHER = 'b'.repeat(40), PROBE = 'c'.repeat(32);
const base = { origin: 'https://hrbp.example', expectedRevision: SHA, nonce: () => PROBE };
const healthy = (changes = {}) => ({ ...runtimeHealth(SHA, PROBE), ...changes });
const reply = (body = healthy(), headers = {}) => Response.json(body, { headers: { 'cache-control': 'no-store', ...headers } });
const checkout = (status = '') => args => args[0] === 'rev-parse' ? SHA : status;
const missingGit = () => { throw new Error('git not installed'); };

test('revision label uses the clean checked-out source', () => {
  assert.equal(getBuildRevision({ env: {}, runGit: checkout() }), SHA);
  assert.equal(getBuildRevision({ env: { GITHUB_SHA: SHA.toUpperCase() }, runGit: checkout() }), SHA);
});
test('Cloudflare build declaration and Git checkout must agree', () => {
  assert.equal(getBuildRevision({ env: { WORKERS_CI_COMMIT_SHA: SHA }, runGit: checkout() }), SHA);
  assert.throws(() => getBuildRevision({ env: { WORKERS_CI_COMMIT_SHA: OTHER }, runGit: checkout() }), /disagree/);
});
test('archive builds can use full CI declarations but missing identity stays unknown', () => {
  assert.equal(getBuildRevision({ env: { WORKERS_CI_COMMIT_SHA: SHA }, runGit: missingGit }), SHA);
  assert.equal(getBuildRevision({ env: { GITHUB_SHA: SHA }, runGit: missingGit }), SHA);
  assert.equal(getBuildRevision({ env: {}, runGit: missingGit }), 'unknown');
});
test('conflicting or malformed declared revisions fail without disclosing their values', () => {
  assert.throws(() => getBuildRevision({ env: { GITHUB_SHA: SHA, WORKERS_CI_COMMIT_SHA: OTHER }, runGit: missingGit }), /Conflicting/);
  for (const value of ['short', SHA+'\n', 'token-secret-value', 'x'.repeat(40), ['a']]) {
    assert.throws(() => getBuildRevision({ env: { GITHUB_SHA: value }, runGit: checkout() }), /Invalid CI/);
  }
});
test('dirty or unreadable tracked worktrees never report their clean parent', () => {
  assert.equal(getBuildRevision({ env: { GITHUB_SHA: SHA }, runGit: checkout(' M app/page.tsx') }), 'unknown');
  assert.equal(getBuildRevision({ env: {}, runGit: args => { if(args[0]==='rev-parse')return SHA;throw Error(); } }), 'unknown');
});
test('health response is a bounded public liveness contract', () => {
  const payload = runtimeHealth(SHA, PROBE, new Date('2026-10-04T12:00:00Z'));
  assert.deepEqual(payload, { ok: true, service: 'hrbp', runtime: 'cloudflare-workers',
    timestamp: '2026-10-04T12:00:00.000Z', release: { protocolVersion: 1, revision: SHA },
    probe: PROBE, scope: 'runtime-and-release-only' });
});
test('health ignores invalid revision and untrusted probe instead of reflecting them', () => {
  for(const value of [null, undefined, 'token-secret', '<script>', 'a'.repeat(41)]) {
    assert.equal(runtimeHealth(value,value).release.revision,null);
    assert.equal(runtimeHealth(value,value).probe,null);
  }
  assert.equal(normalizedRevision(SHA.toUpperCase()),SHA);
});

for(const origin of ['http://hrbp.example','https://user:secret@hrbp.example','https://hrbp.example/a',
  'https://hrbp.example/?a=b','https://hrbp.example/#hash','file:///','not a url']) {
  test(`reject invalid origin: ${origin}`, () => assert.throws(() => deploymentConfig({...base,origin})));
}
test('local smoke is explicit and excludes LAN/metadata hosts', () => {
  assert.throws(() => deploymentConfig({...base,origin:'http://127.0.0.1:8787'}));
  assert.throws(() => deploymentConfig({...base,origin:'http://169.254.169.254',localSmoke:true}));
  assert.throws(() => deploymentConfig({...base,origin:'http://10.0.0.1',localSmoke:true}));
  assert.equal(deploymentConfig({...base,origin:'http://127.0.0.1:8787',localSmoke:true}).origin,'http://127.0.0.1:8787');
});
test('invalid expected hash, timeout and nonce fail before network access', async () => {
  let calls=0;
  for(const extra of [{expectedRevision:'unknown'},{timeoutMs:0},{timeoutMs:30001},{timeoutMs:1.5},{nonce:()=> 'bad'}]) {
    await assert.rejects(verifyDeployment({...base,...extra,fetchImpl:async()=>{calls++;return reply();}}));
  }
  assert.equal(calls,0);
});
test('matching build requires a fresh anonymous GET with no redirect or credential forwarding', async () => {
  let calls=0;
  const report=await verifyDeployment({...base,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url.pathname,'/api/health/runtime');assert.equal(url.searchParams.get('probe'),PROBE);
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
    return reply();
  }});
  assert.equal(calls,1);assert.equal(report.success,true);assert.equal(report.code,'REVISION_MATCH');
});
for(const [name,body,code] of [
  ['wrong revision',healthy({release:{protocolVersion:1,revision:OTHER}}),'REVISION_MISMATCH'],
  ['unknown revision',healthy({release:{protocolVersion:1,revision:null}}),'RELEASE_UNIDENTIFIED'],
  ['untrusted revision',healthy({release:{protocolVersion:1,revision:'private-token'}}),'RELEASE_UNIDENTIFIED'],
  ['old health endpoint',{ok:true,service:'hrbp'},'RELEASE_PROTOCOL_UNAVAILABLE'],
  ['wrong version',healthy({release:{protocolVersion:2,revision:SHA}}),'RELEASE_PROTOCOL_UNAVAILABLE'],
  ['wrong scope',healthy({scope:'all-features-healthy'}),'RELEASE_PROTOCOL_UNAVAILABLE'],
  ['cached response',healthy({probe:'d'.repeat(32)}),'FRESH_RESPONSE_UNCONFIRMED'],
  ['service mismatch',healthy({service:'other'}),'UNEXPECTED_SERVICE'],
  ['not alive',healthy({ok:false}),'UNEXPECTED_SERVICE'],
  ['null response',null,'UNEXPECTED_SERVICE']
]) {
  test(`${name} is never a deployment success`,async()=>{
    const report=await verifyDeployment({...base,fetchImpl:async()=>reply(body)});
    assert.equal(report.success,false);assert.equal(report.code,code);
    assert.ok(!JSON.stringify(report).includes('private-token'));
  });
}
test('missing no-store is not accepted as fresh even when nonce matches',async()=>{
  const report=await verifyDeployment({...base,fetchImpl:async()=>reply(healthy(),{'cache-control':'public, max-age=60'})});
  assert.equal(report.code,'FRESH_RESPONSE_UNCONFIRMED');
});
for(const status of [301,302,401,403,404,500,503]) {
  test(`HTTP ${status} is classified without reading or logging raw error data`,async()=>{
    const report=await verifyDeployment({...base,fetchImpl:async()=>new Response('private-error',{status})});
    assert.equal(report.success,false);assert.equal(report.httpStatus,status);
    assert.equal(report.code,[401,403].includes(status)?'ACCESS_BLOCKED':'HTTP_FAILURE');
    assert.ok(!JSON.stringify(report).includes('private-error'));
  });
}
test('HTML login/challenge pages with HTTP 200 cannot pass',async()=>{
  const report=await verifyDeployment({...base,fetchImpl:async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})});
  assert.equal(report.code,'UNEXPECTED_CONTENT_TYPE');
});
for(const [name,body] of [['malformed JSON','{'],['oversized','x'.repeat(8193)],['invalid UTF8',new Uint8Array([255])]]) {
  test(`${name} is rejected`,async()=>{
    const report=await verifyDeployment({...base,fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json'}})});
    assert.equal(report.code,'INVALID_RESPONSE');
  });
}
test('transport failure does not retry, leak exception or imply the application is down',async()=>{
  let calls=0;
  const report=await verifyDeployment({...base,fetchImpl:async()=>{calls++;throw Error('private-network-value');}});
  assert.equal(calls,1);assert.equal(report.code,'REACHABILITY_UNCONFIRMED');
  assert.ok(!JSON.stringify(report).includes('private-network-value'));
});
test('real localhost HTTP response exercises the same production checker',async()=>{
  const requests=[];
  const server=createServer((req,res)=>{
    requests.push({method:req.method,url:req.url});
    const url=new URL(req.url,'http://127.0.0.1');
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify(runtimeHealth(SHA,url.searchParams.get('probe'))));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const report=await verifyDeployment({...base,origin:`http://127.0.0.1:${server.address().port}`,localSmoke:true});
    assert.equal(report.success,true);assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('real stalled body is aborted within the configured request budget',async()=>{
  const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const report=await verifyDeployment({...base,origin:`http://127.0.0.1:${server.address().port}`,localSmoke:true,timeoutMs:100});
    assert.equal(report.success,false);assert.equal(report.code,'TIMEOUT');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('summary clearly limits a successful check to runtime/revision',async()=>{
  const report=await verifyDeployment({...base,fetchImpl:async()=>reply()});
  const summary=deploymentSummary(report);assert.match(summary,/NOT verified/);assert.match(summary,/REVISION_MATCH/);
  assert.ok(!summary.includes(base.origin));
});
test('Next config embeds only the allowlisted public build label and health stays DB-free',async()=>{
  const config=await readFile(new URL('../next.config.ts',import.meta.url),'utf8');
  const route=await readFile(new URL('../app/api/health/runtime/route.ts',import.meta.url),'utf8');
  assert.match(config,/env:\s*\{\s*HRBP_BUILD_REVISION:\s*getBuildRevision\(\)\s*\}/);
  assert.doesNotMatch(config,/\.\.\.process\.env/);
  assert.match(route,/process\.env\.HRBP_BUILD_REVISION/);
  assert.match(route,/process\.env\.HRBP_RUNTIME_PROFILE/);
  assert.match(route,/runtimeHealth\([\s\S]*HRBP_BUILD_REVISION[\s\S]*probe[\s\S]*HRBP_RUNTIME_PROFILE/);
  assert.doesNotMatch(route,/prisma|@\/lib\/db|SESSION_SECRET|DATABASE_URL/);
  assert.match(route,/force-dynamic/);assert.match(route,/no-store/);
});
