import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createProductionSbom, productionLockGraph, validateProductionSbom, SBOM_SCOPE } from './release-sbom.mjs';
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const purl = (name, version) => `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;
const component = (location, name, version = '1.0.0') => ({ name, version, type: 'library',
  'bom-ref': `${name}@${version}`, purl: purl(name, version),
  properties: [{ name: 'cdx:npm:package:path', value: location }] });
function fixture() {
  const pkg = { name: 'release-fixture', version: '1.0.0', dependencies: { runtime: '1.0.0', ui: '1.0.0' }, devDependencies: { 'build-tool': '1.0.0' } };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': structuredClone(pkg),
    'node_modules/runtime': { version: '1.0.0', dependencies: { leaf: '1.0.0' }, peerDependencies: { ui: '1.0.0' }, optionalDependencies: { missing: '1.0.0' } },
    'node_modules/ui': { version: '1.0.0' },
    'node_modules/leaf': { version: '1.0.0' },
    'node_modules/build-tool': { version: '1.0.0', dev: true, peerDependencies: { runtime: '1.0.0' } }
  } };
  const full = { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: { component: component('', pkg.name) }, components: ['runtime','ui','leaf','build-tool'].map(n => component(`node_modules/${n}`, n)), dependencies: [] };
  return { pkg, lock, full };
}
function good() { const f = fixture(); return { ...f, sbom: createProductionSbom(f.full, f.pkg, f.lock) }; }

test('positive production roots retain runtime peer of a dev tool and its descendants', () => {
  const { sbom, pkg, lock } = good();
  assert.deepEqual(sbom.components.map(c => c.name).sort(), ['leaf','runtime','ui']);
  assert.deepEqual(validateProductionSbom(sbom, pkg, lock), { components: 3, directDependencies: 2, scope: SBOM_SCOPE });
  assert.ok(sbom.dependencies.find(d => d.ref === 'urn:hrbp:sbom:node_modules%2Fruntime').dependsOn.includes('urn:hrbp:sbom:node_modules%2Fui'));
});
test('generation cannot repair a truncated npm inventory by inventing missing components', () => {
  const f=fixture(); f.full.components=f.full.components.filter(c=>c.name!=='runtime');
  assert.throws(()=>createProductionSbom(f.full,f.pkg,f.lock), /omitted locked production package runtime/);
});
test('input objects and lockfile are not mutated', () => {
  const f=fixture(), before=JSON.stringify(f); createProductionSbom(f.full,f.pkg,f.lock); assert.equal(JSON.stringify(f),before);
});
test('root identity is the package, not the checkout folder or a metadata substring', () => {
  const f=fixture(); f.full.metadata.component.name='checkout-directory';
  const sbom=createProductionSbom(f.full,f.pkg,f.lock); assert.equal(sbom.metadata.component.name, f.pkg.name);
});
test('root runtime dependency mistakenly flagged dev is still selected', () => {
  const f=fixture(); f.lock.packages['node_modules/runtime'].dev=true;
  assert.ok(createProductionSbom(f.full,f.pkg,f.lock).components.some(c=>c.name==='runtime'));
});
test('resolved optional peers and platform packages are included without host-OS filtering', () => {
  const f=fixture(); f.lock.packages['node_modules/runtime'].optionalDependencies={platform:'1.0.0'};
  f.lock.packages['node_modules/runtime'].peerDependencies.extra='1.0.0';
  f.lock.packages['node_modules/runtime'].peerDependenciesMeta={extra:{optional:true}};
  f.lock.packages['node_modules/platform']={version:'1.0.0',os:['not-the-current-os'],optional:true};
  f.full.components.push(component('node_modules/platform','platform'));
  assert.ok(createProductionSbom(f.full,f.pkg,f.lock).components.some(c=>c.name==='platform'));
});
test('nested versions resolve from their own parent and retain distinct references', () => {
  const f=fixture(); f.lock.packages['node_modules/runtime/node_modules/leaf']={version:'2.0.0'};
  f.lock.packages['node_modules/runtime'].dependencies.leaf='2.0.0';
  f.lock.packages['node_modules/ui'].dependencies={leaf:'1.0.0'};
  f.full.components.push(component('node_modules/runtime/node_modules/leaf','leaf','2.0.0'));
  const s=createProductionSbom(f.full,f.pkg,f.lock);assert.deepEqual(s.components.filter(c=>c.name==='leaf').map(c=>c.version).sort(),['1.0.0','2.0.0']);
});
test('duplicate native name/version refs at distinct locked paths become unique CycloneDX refs', () => {
  const f=fixture();f.lock.packages['node_modules/runtime/node_modules/leaf']={version:'1.0.0'};
  f.lock.packages['node_modules/ui'].dependencies={leaf:'1.0.0'};
  f.full.components.push(component('node_modules/runtime/node_modules/leaf','leaf'));
  const s=createProductionSbom(f.full,f.pkg,f.lock);assert.equal(new Set(s.components.map(c=>c['bom-ref'])).size,s.components.length);
});
test('scoped package descendants and peer resolution use the containing installation level', () => {
  const f=fixture();f.pkg.dependencies={'@scope/runtime':'1.0.0'};f.lock.packages[''].dependencies={...f.pkg.dependencies};
  f.lock.packages['node_modules/@scope/runtime']={version:'1.0.0',peerDependencies:{ui:'1.0.0'}};
  f.full.components.push(component('node_modules/@scope/runtime','@scope/runtime'));
  const graph=productionLockGraph(f.pkg,f.lock);assert.deepEqual([...graph.get('node_modules/@scope/runtime').dependencies],['node_modules/ui']);
});
test('dependency cycles terminate with a closed graph', () => {
  const f=fixture();f.lock.packages['node_modules/leaf'].dependencies={runtime:'1.0.0'};
  assert.equal(createProductionSbom(f.full,f.pkg,f.lock).components.length,3);
});
for(const [name,mutate] of [
  ['missing runtime with count-padded unrelated package',s=>{s.components[1]=component('node_modules/build-tool','build-tool');}],
  ['wrong version',s=>s.components[0].version='0.0.0'],
  ['wrong purl',s=>s.components[0].purl='pkg:npm/wrong@1.0.0'],
  ['renamed root with identity mentioned only in description',s=>{s.metadata.component.name='wrong';s.metadata.description='release-fixture';}],
  ['missing scope',s=>delete s.metadata.properties],
  ['duplicate path',s=>s.components[1]=structuredClone(s.components[0])],
  ['duplicate reference',s=>s.components[1]['bom-ref']=s.components[0]['bom-ref']],
  ['missing transitive edge',s=>s.dependencies.find(d=>d.ref.includes('runtime')).dependsOn=[]],
  ['disconnected direct dependency',s=>s.dependencies[0].dependsOn.pop()],
  ['dangling edge',s=>s.dependencies[0].dependsOn.push('missing')],
  ['duplicate edge',s=>s.dependencies[0].dependsOn.push(s.dependencies[0].dependsOn[0])],
  ['missing graph node',s=>s.dependencies.pop()],
  ['duplicate graph node',s=>s.dependencies[1]=structuredClone(s.dependencies[0])]
]) test('standalone validator rejects '+name,()=>{const f=good();mutate(f.sbom);assert.throws(()=>validateProductionSbom(f.sbom,f.pkg,f.lock),/SBOM:/);});
for(const [name, mutate] of [
  ['missing required package',f=>delete f.lock.packages['node_modules/leaf']],
  ['missing required peer',f=>{delete f.lock.packages['node_modules/ui'];delete f.pkg.dependencies.ui;delete f.lock.packages[''].dependencies.ui;}],
  ['drifted root declaration',f=>f.pkg.dependencies.runtime='2.0.0'],
  ['old lock without package inventory',f=>f.lock.lockfileVersion=1],
  ['linked packages',f=>f.lock.packages['node_modules/runtime'].link=true],
  ['workspaces',f=>f.pkg.workspaces=['packages/*']]
])test('unsupported/incomplete locked input fails closed: '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>createProductionSbom(f.full,f.pkg,f.lock),/SBOM:/);});

test('actual committed graph contains all nine direct runtime packages including Next and React', () => {
  const pkg=read('package.json'), lock=read('package-lock.json'), graph=productionLockGraph(pkg,lock);
  assert.equal(graph.get('').dependencies.size,Object.keys(pkg.dependencies).length);
  for(const n of ['next','react','react-dom','pg-types','pg-protocol'])assert.ok(graph.has(`node_modules/${n}`));
  assert.ok(!graph.has('node_modules/eslint'));
});

test('real npm lock-only generator and standalone validator reject tampering even with refreshed digests', {timeout:30000}, () => {
  const dir=mkdtempSync(path.join(tmpdir(),'hrbp-sbom-test-'));
  const root=process.cwd();const f=fixture();
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const run=(cmd,args)=>execFileSync(cmd,args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000,env:{...process.env,GITHUB_SHA:''}});
  const hash=file=>createHash('sha256').update(readFileSync(path.join(dir,'.release-evidence',file))).digest('hex');
  try{
    writeFileSync(path.join(dir,'package.json'),JSON.stringify(f.pkg));writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify(f.lock));
    for(const name of ['Dockerfile.onprem','docker-compose.onprem.yml','.env.onprem.example'])writeFileSync(path.join(dir,name),'# synthetic release input\n');
    mkdirSync(path.join(dir,'prisma/migrations/test'),{recursive:true});writeFileSync(path.join(dir,'prisma/migrations/test/migration.sql'),'SELECT 1;\n');
    run('git',['init','-q']);run('git',['add','.']);run('git',['-c','user.name=QA','-c','user.email=qa@example.test','commit','-qm','Synthetic release fixture']);
    const generated=JSON.parse(run(process.execPath,[path.join(root,'scripts/generate-release-evidence.mjs')]));assert.equal(generated.sbomComponents,3);
    assert.equal(JSON.parse(run(process.execPath,[path.join(root,'scripts/validate-release-evidence.mjs')])).ok,true);
    const saved=read(path.join(dir,'.release-evidence/hrbp-one.cdx.json'));saved.components=saved.components.filter(c=>c.name!=='runtime');
    writeFileSync(path.join(dir,'.release-evidence/hrbp-one.cdx.json'),JSON.stringify(saved));
    const manifest=read(path.join(dir,'.release-evidence/release-manifest.json'));manifest.sbom.sha256=hash('hrbp-one.cdx.json');
    writeFileSync(path.join(dir,'.release-evidence/release-manifest.json'),JSON.stringify(manifest));
    writeFileSync(path.join(dir,'.release-evidence/SHA256SUMS'),['hrbp-one-source.tar','hrbp-one.cdx.json','release-manifest.json'].map(n=>`${hash(n)}  ${n}`).join('\n')+'\n');
    const rejected=spawnSync(process.execPath,[path.join(root,'scripts/validate-release-evidence.mjs')],{cwd:dir,encoding:'utf8',timeout:20000});
    assert.equal(rejected.status,1);assert.match(rejected.stderr,/SBOM:/);
    assert.ok(!readFileSync(path.join(dir,'package-lock.json'),'utf8').includes('hrbp:sbom:scope'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('artifact hashes must match locked integrity, not merely the artifact self-checksum', () => {
  const f=fixture();const bytes=Buffer.alloc(64,42);
  f.lock.packages['node_modules/runtime'].integrity='sha512-'+bytes.toString('base64');
  f.full.components.find(c=>c.name==='runtime').hashes=[{alg:'SHA-512',content:bytes.toString('hex')}];
  const s=createProductionSbom(f.full,f.pkg,f.lock);
  s.components.find(c=>c.name==='runtime').hashes[0].content='0'.repeat(128);
  assert.throws(()=>validateProductionSbom(s,f.pkg,f.lock),/integrity differs/);
});
