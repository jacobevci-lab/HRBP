import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { openReceiptWindow, assertSingleExport, readReceipts } from './audit-download-receipts.mjs';

const name = `observer-unit-${randomUUID()}.jsonl`;
test('passive HTTP observer records actual receipts and keeps request/response untouched', { timeout: 20000 }, async (t) => {
  const child = spawn(process.execPath, ['--require', './scripts/audit-download-observer.cjs', '--input-type=module', '-e', `
    import http from 'node:http';
    const server=http.createServer(async(req,res)=>{
      if(req.url.startsWith('/api/audit/export')){
        res.writeHead(200,{'content-type':'text/csv','content-disposition':'attachment; filename="synthetic.csv"'});
        res.end('id,name\\n1,synthetic\\n');
      }else res.end('ok');
    });
    server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
  `], { cwd: process.cwd(), env: { ...process.env, HRBP_DISPOSABLE_AUDIT: 'true', DATABASE_URL: 'postgresql://synthetic@127.0.0.1/hrbp_audit', HRBP_AUDIT_RECEIPTS: name }, stdio: ['ignore','pipe','pipe'] });
  let stderr=''; child.stderr.on('data', data=>{stderr+=data});
  try {
    const port = await Promise.race([once(child.stdout,'data').then(([b])=>Number(String(b).trim())), once(child,'exit').then(()=>{throw new Error(stderr)})]);
    const origin=`http://127.0.0.1:${port}`;
    const get = (path, options={}) => fetch(origin+path,{...options,signal:AbortSignal.timeout(5000)});
    await (await get('/api/health/runtime')).text();
    const receipts=await openReceiptWindow(name);
    await t.test('zero requests before explicit export', async()=>assert.deepEqual(await receipts(),[]));
    const target=origin+'/api/audit/export?q=synthetic&actor=test';
    const response=await get('/api/audit/export?q=synthetic&actor=test',{headers:{cookie:'secret-session-never-record',authorization:'Bearer never-log-this'}});
    assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);
    assert.equal(await response.text(),'id,name\n1,synthetic\n');
    await t.test('one received request with exact target, no secret logging',async()=>{
      assertSingleExport(await receipts(),target);
      const {source}=await readReceipts(name);
      for(const text of ['secret-session','never-log-this','synthetic&actor'])assert.ok(!source.includes(text));
    });
    await (await get('/api/audit/export?q=synthetic&actor=test')).text();
    await t.test('missing or duplicate export is a hard failure',async()=>{
      assert.throws(()=>assertSingleExport([],target));
      const duplicated=await receipts(); assert.equal(duplicated.length,2);
      assert.throws(()=>assertSingleExport(duplicated,target));
    });
    const prefetch=await openReceiptWindow(name);
    await (await get('/api/audit/export',{headers:{'next-router-prefetch':'1',rsc:'1'}})).text();
    await t.test('unsolicited prefetch remains detectable',async()=>{
      const prefetched=await prefetch();assert.equal(prefetched.length,1);
      assert.equal(prefetched[0].prefetch,true);assert.equal(prefetched[0].rsc,true);
      assert.throws(()=>assertSingleExport(prefetched,origin+'/api/audit/export'));
    });
  }finally{
    if(child.exitCode===null){child.kill();await once(child,'exit').catch(()=>{});}await unlink(new URL(`../.audit/${name}`,import.meta.url)).catch(()=>{});
  }
});
for(const url of ['postgresql://synthetic@remote.invalid/hrbp_audit','postgresql://synthetic@localhost/production']){
  test('observer refuses non-disposable database '+new URL(url).pathname,async()=>{
    const child=spawn(process.execPath,['--require','./scripts/audit-download-observer.cjs','-e',''],{env:{...process.env,HRBP_DISPOSABLE_AUDIT:'true',DATABASE_URL:url},stdio:'ignore'});
    const [code]=await once(child,'exit');assert.notEqual(code,0);
  });
}
