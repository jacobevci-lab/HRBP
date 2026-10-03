/** Wiring guards complement the real-browser download/layout regression. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

function elements(path) {
 const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),items=[];
 function visit(node){if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))items.push({node,tag:node.tagName.getText(source),attributes:node.attributes.properties,source});ts.forEachChild(node,visit);}
 visit(source);return items;
}
function attr(item,name){return item.attributes.find(a=>ts.isJsxAttribute(a)&&a.name.getText(item.source)===name);}
test('audit CSV is an explicit native download, not a prefetched React route',()=>{
 const targets=elements('components/audit-live-page.tsx').filter(x=>attr(x,'href')?.getText(x.source).includes('/api/audit/export'));
 assert.equal(targets.length,1);assert.equal(targets[0].tag,'a');assert.ok(attr(targets[0],'download'));
});
test('known API exports and downloads are never Next Link navigation',()=>{
 let matched=0;
 for(const name of readdirSync('components').filter(x=>x.endsWith('.tsx'))){
  for(const item of elements('components/'+name)){
   const href=attr(item,'href')?.getText(item.source)||'';
   if(href.includes('/api/')&&/\/(?:export|download)(?:[?`"'}]|$)/.test(href)){
    matched++;assert.notEqual(item.tag,'Link',`${name}: an API attachment is not an application page`);
   }
  }
 }
 assert.ok(matched>=3,'Inventory must cover audit, decision history and document download');
});
test('server locale readiness markers accompany audit and governance output',()=>{
 assert.ok(elements('components/audit-live-page.tsx').some(x=>attr(x,'data-audit-locale')));
 assert.equal(elements('components/governance-planning-live-workspace.tsx').filter(x=>attr(x,'data-governance-locale')).length,5);
});
test('natural download/layout checks are a required regression workflow step',()=>{
 const workflow=readFileSync('.github/workflows/platform-regression.yml','utf8');
 assert.match(workflow,/node scripts\/platform-render-regression\.mjs/);
 const source=readFileSync('scripts/platform-render-regression.mjs','utf8');
 assert.match(source,/waitForEvent\('download'\)/);assert.match(source,/download\.saveAs/);
 assert.match(source,/assert\.deepEqual\(report\.failures,\[\]/);
 const gate=readFileSync('scripts/platform-remediation-gate.mjs','utf8');
 assert.match(gate,/base\.mobileOverflow\.length===0&&browser\.mobileOverflow\.length===0/);
});
