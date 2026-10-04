/** Calibrate native attachment observation using the same installed browser as the app regression. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { openReceiptWindow, assertSingleExport } from './audit-download-receipts.mjs';
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
const name = `calibration-${randomUUID()}.jsonl`;
const observations = [];
const child = spawn(process.execPath, ['--require', './scripts/audit-download-observer.cjs', '--input-type=module', '-e', `
  import http from 'node:http';
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/api/audit/export')){
      res.writeHead(200,{'content-type':'text/csv','content-disposition':'attachment; filename="synthetic.csv"','cache-control':'no-store'});
      res.end('id,name\\n1,synthetic\\n');
    }else if(req.url==='/api/health/runtime')res.end('ok');
    else {res.writeHead(200,{'content-type':'text/html'});res.end('<a id="native" href="/api/audit/export?kind=native" download>Native</a><a id="navigation" href="/api/audit/export?kind=navigation">Navigation</a>');}
  });server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
`], { env: { ...process.env, HRBP_AUDIT_RECEIPTS: name }, stdio: ['ignore','pipe','pipe'] });
let stderr='';child.stderr.on('data',data=>{stderr+=data});
let browser;
try {
  const port=await Promise.race([once(child.stdout,'data').then(([b])=>Number(String(b).trim())),once(child,'exit').then(()=>{throw new Error(stderr)})]);
  const origin=`http://127.0.0.1:${port}`;
  await (await fetch(origin+'/api/health/runtime',{signal:AbortSignal.timeout(5000)})).text();
  browser=await chromium.launch();
  for(const routed of [false,true])for(const kind of ['native','navigation']){
    const context=await browser.newContext({acceptDownloads:true});
    try {
      if(routed)await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const page=await context.newPage();let pageEvents=0,contextEvents=0,downloads=0;
      const isExport=r=>new URL(r.url()).pathname==='/api/audit/export';
      page.on('request',r=>{if(isExport(r))pageEvents++});
      context.on('request',r=>{if(isExport(r))contextEvents++});
      page.on('download',()=>downloads++);
      const receipts=await openReceiptWindow(name);
      await page.goto(origin);await page.locator('#'+kind).hover();
      await page.waitForTimeout(100);
      assert.deepEqual(await receipts(),[],'A visible download link must not be requested before a click');
      const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#'+kind).click()]);
      const stream=await download.createReadStream();let content='';for await(const chunk of stream)content+=chunk.toString();
      assert.equal(content,'id,name\n1,synthetic\n');assert.equal(await download.failure(),null);
      assert.equal(downloads,1);const received=await receipts();
      assertSingleExport(received,origin+'/api/audit/export?kind='+kind);
      observations.push({routed,kind,serverRequests:received.length,pageEvents,contextEvents,downloads});
    }finally{await context.close();}
  }
}finally{
  if(browser)await browser.close();
  if(child.exitCode===null){child.kill();await once(child,'exit');}
  await mkdir('.audit',{recursive:true});
  await writeFile('.audit/download-observer-calibration.json',JSON.stringify(observations,null,2));
  console.log('DOWNLOAD_OBSERVER_CALIBRATION '+JSON.stringify(observations));
}
assert.equal(observations.length,4,'Every native/navigation and routing calibration must finish');
