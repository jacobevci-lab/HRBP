/** Real server components rendered with controlled read/session dependencies.
 * Browser/layout acceptance is a separate production-app run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function compile(file,mocks){
  const r=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
  assert.equal(r.diagnostics.filter(d=>d.category===1).length,0);
  const m={exports:{}};new Function('module','exports','require',r.outputText)(m,m.exports,n=>{assert.ok(n in mocks,n);return mocks[n];});return m.exports;
}
function harness(slug,{locale='tr',ctx={tenantId:'tenant-a',actorId:'actor-a',employmentId:'self',role:'MANAGER'},grant=true,empty=false,error=null}={}){
  const calls=[],jsx=(type,props)=>typeof type==='function'?type(props):{type,props};
  const row={id:'record-a',employee:'Customer English Name',employeeNumber:'EMP-A',position:'Customer Position',organization:'Customer Organization',employmentId:'other',
    status:'Pending',rawStatus:'PENDING',unit:'DAYS',units:'1.25',leaveType:'Customer Leave',startsAt:'2028-01-01',endsAt:'2028-01-02',minutes:125,overtimeMinutes:20,startAt:'09:00',endAt:'11:05',source:'API',
    name:'Customer Plan',code:'CUSTOM',type:'Health',provider:'Customer Provider',country:'TR',enrolled:3,pending:1,coverage:25,currency:'TRY',employerCost:1234,
    title:'Customer Course',requirement:'Mandatory',assigned:5,completed:2,rate:40,dueAt:'2028-01-01'};
  const data={expected:4,recorded:3,overtimeMinutes:20,exceptions:0,scheduleCoverage:75,pending:1,awayToday:0,balanceRecords:2,averageRemaining:5,focusVisible:true,
    activeEmployments:4,activeEnrollments:3,pendingEnrollments:1,activePlans:1,compliance:40,skillCount:1,criticalSkills:1,overdue:0,due30:2,
    rows:empty?[]:[row,{...row,id:'self-row',employmentId:'self',unit:'HOURS'}],courses:empty?[]:[row],skills:empty?[]:[{id:'s',name:'Customer Skill',category:'Customer Category',code:'SK',critical:true,assessed:2}]};
  const load=async(...args)=>{calls.push(args);if(error)throw error;return data;};
  const mocks={'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{default:'Link'},'lucide-react':new Proxy({},{get:(_,k)=>String(k)}),
    '@/lib/server-session':{getServerRequestContext:async()=>ctx},'@/lib/i18n-server':{getServerLocale:async()=>locale},'@/lib/authorization':{can:()=>grant},
    '@/lib/work-pay-live-data':{getLeaveLiveData:load,getTimeAttendanceLiveData:load,getPayrollLiveData:load},
    '@/components/work-pay-workspace':{WorkPayWorkspace:'PublicWorkPay'},'@/components/leave-decision-buttons':{LeaveDecisionButtons:'LeaveDecision'},
    '@/components/payroll-transition-button':{PayrollTransitionButton:'PayrollDecision'},'@/components/time-entry-transition-buttons':{TimeEntryTransitionButtons:'TimeDecision'},
    '@/lib/growth-live-data':{getBenefitsGrowthData:load,getLearningGrowthData:load,getPerformanceGrowthData:load,getSuccessionGrowthData:load,getTalentGrowthData:load},
    '@/components/growth-workspace':{GrowthWorkspace:'PublicGrowth'}};
  const isWork=['leave','time-attendance'].includes(slug), file=`components/${isWork?'work-pay':'growth'}-live-workspace.tsx`;
  const exports=compile(file,mocks);return {calls,data,render:()=>exports[isWork?'WorkPayLiveWorkspace':'GrowthLiveWorkspace']({slug})};
}
function all(tree,pred){if(!tree||typeof tree!=='object')return [];return [...(pred(tree)?[tree]:[]),...Object.values(tree).flatMap(v=>Array.isArray(v)?v.flatMap(x=>all(x,pred)):all(v,pred))];}
function visible(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);if(Array.isArray(tree))return tree.map(visible).join(' ');return tree?.props?visible(tree.props.children):'';}
for(const [slug,en,tr] of [['leave','Request & approval queue','Talep ve onay kuyruğu'],['time-attendance','Attendance operating view','Zaman ve devam kayıtları'],['benefits','Plan coverage & enrollment','Plan kapsamı ve katılım'],['learning','Assigned learning','Atanmış eğitimler']]){
  for(const locale of ['en','tr'])test(`${slug}: ${locale} live headings, tables and read identity`,async()=>{
    const h=harness(slug,{locale}), tree=await h.render(), text=visible(tree);
    assert.ok(text.includes(locale==='tr'?tr:en));assert.ok(!text.includes(locale==='tr'?en:tr));
    assert.equal(tree.props.lang,locale);assert.equal(tree.props['data-workforce-live'],slug);assert.equal(h.calls.length,1);
    assert.equal(typeof h.calls[0][0]==='string'?h.calls[0][0]:h.calls[0][0].tenantId,'tenant-a');
    assert.ok(text.includes(slug==='learning'?'Customer Course':slug==='benefits'?'Customer Plan':'Customer English Name'));
  });
  test(`${slug}: denied and anonymous views never read private data`,async()=>{
    for(const opts of [{ctx:null},{grant:false}]){const h=harness(slug,opts);await h.render();assert.equal(h.calls.length,0);}
  });
  test(`${slug}: Turkish empty state is localized without making synthetic rows`,async()=>{
    const h=harness(slug,{empty:true}), tree=await h.render();assert.match(visible(tree),/bulunmuyor/);assert.doesNotMatch(visible(tree),/Customer |No active|No time|No leave|No learning/);
  });
  test(`${slug}: read failures propagate instead of becoming demo success`,async()=>{
    const error=Error('read unavailable');await assert.rejects(harness(slug,{error}).render(),e=>e===error);
  });
}
test('translation preserves raw statuses/CSS and never enables self-approval',async()=>{
  for(const locale of ['en','tr']){const h=harness('leave',{locale}),tree=await h.render();
    assert.equal(all(tree,n=>n.type==='LeaveDecision').length,1);
    assert.equal(all(tree,n=>n.type==='LeaveDecision')[0].props.requestId,'record-a');
    assert.equal(all(tree,n=>n.props?.className==='workpay-status pending').length,2);
    assert.ok(visible(tree).includes(locale==='tr'?'Bekliyor':'Pending'));
    assert.ok(visible(tree).includes(locale==='tr'?'gün':'days'));assert.ok(visible(tree).includes(locale==='tr'?'saat':'hours'));
  }
});
test('time targets stay identical across locales and use raw machine states',async()=>{
  const control=[];for(const locale of ['en','tr']){const h=harness('time-attendance',{locale});h.data.rows.forEach(r=>{r.rawStatus='SUBMITTED';r.status='Submitted';});
    control.push(all(await h.render(),n=>n.type==='TimeDecision').map(n=>n.props));}
  assert.deepEqual(control[0],control[1]);assert.deepEqual(control[0][0].targets,['APPROVED','REJECTED']);assert.deepEqual(control[0][1].targets,[]);
});
test('learning combined completed/waived count is described honestly in both languages',async()=>{
  for(const locale of ['en','tr']){const tree=await harness('learning',{locale}).render();assert.ok(visible(tree).includes(locale==='tr'?'Tamamlanan veya muaf':'Completed or waived'));}
});
test('approval paragraph has a scoped typography rule without changing theme tokens',()=>{
  const css=readFileSync('app/work-pay.css','utf8'),match=css.match(/\[data-workforce-live="leave"\] \.workforce-approval-description\s*\{([^}]+)\}/);
  assert.ok(match);assert.match(match[1],/font-size:\s*12px/);assert.match(match[1],/line-height:\s*1\.6/);assert.match(match[1],/var\(--muted\)/);assert.doesNotMatch(match[1],/!important|#[0-9a-f]{3,8}|overflow:\s*hidden/i);
});

// transpileModule above checks syntax, not type semantics. Exercise the actual
// leave-unit JSX expression against the closed enum from the Prisma schema so
// an unreachable fallback cannot pass these component tests but break next build.
test('leave unit rendering type-checks with the complete Prisma unit union', () => {
  const source = readFileSync('components/work-pay-live-workspace.tsx', 'utf8');
  const ast = ts.createSourceFile('workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions = [];
  const helpers = [];
  const visit = node => {
    if (ts.isJsxExpression(node) && node.expression && /\brow\.unit\b/.test(node.expression.getText(ast)) &&
        !ts.isCallExpression(node.parent)) {
      // Only the smallest expression using the unit, not an enclosing row map.
      if (!node.expression.getText(ast).includes('data.rows.map')) expressions.push(node.expression.getText(ast));
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'leaveUnitLabel') helpers.push(node.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(expressions.length, 1, 'Exactly one actual leave-unit display expression is checked');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const members = schema.match(/enum\s+LeaveUnit\s*\{([^}]+)\}/)?.[1].match(/^\s*([A-Z][A-Z_0-9]*)\s*$/gm)?.map(x => x.trim());
  assert.ok(members?.length, 'Read supported units from the committed schema');
  const filename = '/virtual/hrbp-workspace-unit-check.ts';
  const text = `type Locale = "en" | "tr";\n` +
    `declare const row: { unit: ${members.map(x => JSON.stringify(x)).join(' | ')} };\n` +
    `declare const locale: Locale;\ndeclare function c(en: string, tr: string): string;\n` +
    helpers.join('\n') + `\nconst rendered: string = (${expressions[0]});\n`;
  const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, types: [] };
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, language, ...args) => file === filename
    ? ts.createSourceFile(file, text, language, true) : original(file, language, ...args);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
