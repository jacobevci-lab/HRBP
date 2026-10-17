/** Real unified conversation write UI/SQL acceptance. All setup is synthetic and
 * restricted to disposable localhost PostgreSQL; never run on customer data. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
const origin = 'http://localhost:3100', database = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.HRBP_DISPOSABLE_AUDIT, 'true');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname)); assert.equal(database.pathname, '/hrbp_audit');
const password = process.env.HRBP_TEST_ADMIN_PASSWORD; assert.ok(password);
const out = '.audit/hr-service-compose'; await mkdir(out, { recursive: true });
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [],
  scope: 'Production Next.js, Chromium, signed synthetic sessions and disposable PostgreSQL.',
  limitations: ['Not provider deployment or customer UAT.', '50-message pages are replaced, not a whole-history export.',
    'Displayed-revision checks are not durable command replay; no attachments/provider delivery.',
    'No background polling; explicit refresh reauthorizes. Already disclosed data cannot be recalled.',
    'Author names are current directory names; message timestamps are UTC.'] };
const db = new PrismaClient(), browser = await chromium.launch(), contexts = [], ticketIds = [];
const marker = 'qacompose-' + randomUUID().slice(0, 8), selfId = marker + '-self', staffId = marker + '-staff', peerId = marker + '-peer';
let tenantId, foreignTenant, personId, employmentId, sequence = 0;
const publicText = 'Synthetic public reply ' + marker, privateText = 'Synthetic PRIVATE note ' + marker;
const label = (locale, en, tr) => locale === 'tr' ? tr : en;
async function context(id, locale = 'en', theme = 'light', width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(ctx);
  await ctx.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  if (id) assert.equal((await ctx.request.post(origin + '/api/auth/local', { headers: { origin }, data: { identifier: id, password } })).status(), 200);
  await ctx.addCookies([{ name: 'hrbp-locale', value: locale, url: origin }]);
  await ctx.addInitScript(({ locale, theme }) => { localStorage.setItem('hrbp-locale', locale); localStorage.setItem('hrbp-theme', theme); }, { locale, theme });
  return ctx;
}
async function fixture(status = 'IN_PROGRESS', otherTenant = false) {
  const record = await db.hRServiceRequest.create({ data: { tenantId: otherTenant ? foreignTenant : tenantId,
    requestNumber: marker + '-' + (++sequence), requestorId: selfId, subjectEmploymentId: otherTenant ? null : employmentId,
    category: 'QA', title: 'Synthetic conversation ' + sequence, description: 'Synthetic original description', status, priority: 'MEDIUM' } });
  ticketIds.push(record.id); return record;
}
async function add(ticket, body, visibility = 'REQUESTOR', extra = {}) {
  return db.hRServiceComment.create({ data: { tenantId: ticket.tenantId, requestId: ticket.id, authorId: staffId, body, visibility, ...extra } });
}
async function ready(page, ticket) {
  const response = await page.goto(origin + '/module/hr-service?request=' + encodeURIComponent(ticket.id), { waitUntil: 'load', timeout: 25000 });
  assert.equal(response.status(), 200); await page.locator('.app-shell[data-session-loading="false"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
}
const trigger = (page, ticket, locale = 'en') => page.locator(`[data-hr-service-conversation="${ticket.id}"]`).getByRole('button', { name: label(locale, 'Conversation history', 'Konuşma geçmişi'), exact: true });
const dialog = (page, locale = 'en') => page.getByRole('dialog', { name: label(locale, 'Request conversation', 'Talep konuşması'), exact: true });
async function open(page, ticket, locale = 'en') { await ready(page, ticket); await trigger(page, ticket, locale).click(); const d = dialog(page, locale); await d.waitFor(); return d; }
async function loaded(d) { await d.locator('[aria-busy="false"]').waitFor(); }
const path = ticket => `/api/hr-service/requests/${ticket.id}/conversation`;
async function read(ctx, ticket, cursor = null) { const r = await ctx.request.get(origin + path(ticket) + (cursor ? '?before=' + encodeURIComponent(cursor) : '')); return { response: r, body: await r.json() }; }
async function shot(page, name) { const file = name + '.jpg'; await page.screenshot({ path: out + '/' + file, type: 'jpeg', quality: 80 }); return file; }
async function check(name, page, fn) {
  let row = { name, passed: false };
  try { row = { ...row, ...await fn(), passed: true }; }
  catch (error) { row.error = String(error.message).replaceAll(password, '[redacted]').slice(0, 700); row.screenshot = await shot(page, 'failure-' + report.tests.length).catch(() => null); }
  report.tests.push(row); console.log('CONVERSATION_SCENARIO ' + JSON.stringify(row)); await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
}
try {
  const template = await db.userAccount.findUniqueOrThrow({ where: { id: 'user-local-test-admin' } }); tenantId = template.tenantId; assert.ok(template.localPasswordHash);
  foreignTenant = marker + '-tenant'; await db.tenant.create({ data: { id: foreignTenant, name: 'Synthetic conversation tenant', region: 'QA' } });
  for (const [id, role] of [[selfId, 'EMPLOYEE'], [peerId, 'EMPLOYEE'], [staffId, 'HR_OPERATIONS']]) {
    await db.userAccount.create({ data: { id, tenantId, subject: id, email: id + '@example.test', displayName: 'Synthetic ' + role,
      role, active: true, localAuthEnabled: true, localPasswordHash: template.localPasswordHash } });
  }
  const person = await db.person.create({ data: { tenantId, givenName: 'Synthetic', familyName: marker, workEmail: selfId + '@example.test' } }); personId = person.id;
  employmentId = (await db.employment.create({ data: { tenantId, personId, startDate: new Date('2026-01-01'), status: 'ACTIVE' } })).id;
  const self = await context(selfId), staff = await context(staffId), peer = await context(peerId), anonymous = await context(null);
  const sp = await self.newPage(), hp = await staff.newPage();
  const compose = (d, t) => d.locator(`[data-conversation-compose="${t.id}"]`);
  async function opened(page, t, locale='en') {
    const d = await open(page, t, locale); await d.getByText(t.description,{exact:true}).waitFor(); return d;
  }
  async function send(page,d,t,body,locale='en',privateNote=false) {
    const form=compose(d,t); if(privateNote) await form.getByLabel(label(locale,'Message visibility','Mesaj görünürlüğü'),{exact:true}).selectOption('PRIVATE_NOTE');
    await form.getByLabel(label(locale,'Conversation message','Konuşma mesajı'),{exact:true}).fill(body);
    page.once('dialog', modal=>modal.accept());
    const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/requests/${t.id}/comments`)&&r.request().method()==='POST'),
      form.getByRole('button',{name:privateNote?label(locale,'Save private note','Özel notu kaydet'):label(locale,'Send reply','Yanıtı gönder'),exact:true}).click()]);
    assert.equal(response.status(),201); await form.getByText(label(locale,'The action was saved. You can check the current record.','İşlem kaydedildi. Güncel kaydı kontrol edebilirsiniz.'),{exact:true}).waitFor();
    const saved=await db.hRServiceComment.findFirstOrThrow({where:{tenantId,requestId:t.id,body}});return saved;
  }
  async function refresh(d,locale='en'){await d.getByRole('button',{name:label(locale,'Refresh latest messages','Son mesajları yenile'),exact:true}).click();}
  await check('employee replies inside history, persists one message/audit, and reads it after explicit refresh',sp,async()=>{
    const t=await fixture(),d=await opened(sp,t),body='Unified public '+marker;const saved=await send(sp,d,t,body);
    assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:saved.id,action:'hr-service.comment-added'}}),1);
    assert.equal(saved.authorId,selfId);assert.equal(saved.visibility,'REQUESTOR');
    await refresh(d);await d.locator(`[data-comment-id="${saved.id}"]`).waitFor();assert.equal(await compose(d,t).getByRole('button',{name:'Prepare another message',exact:true}).isEnabled(),true);
    return {screenshot:await shot(sp,'unified-employee-saved')};
  });
  await check('staff writes a private note in history; employee sees neither its text nor badge',hp,async()=>{
    const t=await fixture(),d=await opened(hp,t),body='UNIFIED PRIVATE '+marker;const saved=await send(hp,d,t,body,'en',true);
    assert.equal(saved.visibility,'PRIVATE_NOTE');assert.equal(await db.auditEvent.count({where:{tenantId,resourceId:saved.id,action:'hr-service.private-note-added'}}),1);
    await refresh(d);await d.locator(`[data-comment-id="${saved.id}"]`).waitFor();
    const employee=await opened(sp,t);assert.ok(!(await employee.innerText()).includes(body));assert.equal(await compose(employee,t).getByLabel('Message visibility',{exact:true}).count(),0);
    return {screenshot:await shot(hp,'unified-private-note')};
  });
  await check('cancel send preserves text and creates no comment/audit',hp,async()=>{
    const t=await fixture(),d=await opened(hp,t),form=compose(d,t);await form.getByLabel('Conversation message',{exact:true}).fill('Keep cancelled draft');hp.once('dialog',x=>x.dismiss());
    await form.getByRole('button',{name:'Send reply',exact:true}).click();assert.equal(await form.getByLabel('Conversation message',{exact:true}).inputValue(),'Keep cancelled draft');
    assert.equal(await db.hRServiceComment.count({where:{tenantId,requestId:t.id}}),0);
  });
  await check('private-to-public switch needs a separate cancellable visibility confirmation',hp,async()=>{
    const t=await fixture(),d=await opened(hp,t),form=compose(d,t),select=form.getByLabel('Message visibility',{exact:true});
    await select.selectOption('PRIVATE_NOTE');await form.getByLabel('Conversation message',{exact:true}).fill('Private unsent draft');hp.once('dialog',x=>x.dismiss());await select.selectOption('REQUESTOR');assert.equal(await select.inputValue(),'PRIVATE_NOTE');
    hp.once('dialog',x=>x.accept());await select.selectOption('REQUESTOR');assert.equal(await select.inputValue(),'REQUESTOR');assert.equal(await db.hRServiceComment.count({where:{tenantId,requestId:t.id}}),0);
  });
  await check('confirmed first message needs latest verified read and explicit preparation for a second message',hp,async()=>{
    const t=await fixture(),d=await opened(hp,t);await hp.evaluate(()=>window.QA_COMPOSE_DOCUMENT='same');
    await send(hp,d,t,'First deliberate '+marker);let form=compose(d,t);assert.equal(await form.getByRole('button',{name:'Prepare another message',exact:true}).isDisabled(),true);
    await refresh(d);await d.getByText('First deliberate '+marker,{exact:true}).waitFor();form=compose(d,t);
    await form.getByRole('button',{name:'Prepare another message',exact:true}).click();assert.equal(await db.hRServiceComment.count({where:{tenantId,requestId:t.id}}),1);
    await send(hp,d,t,'Second deliberate '+marker);assert.equal(await db.hRServiceComment.count({where:{tenantId,requestId:t.id}}),2);assert.equal(await hp.evaluate(()=>window.QA_COMPOSE_DOCUMENT),'same');
  });
  for(const fault of ['lost','wrong-body','wrong-visibility'])await check('committed '+fault+' response retains draft and no-replay guard after dialog close/reopen',hp,async()=>{
    const t=await fixture(),d=await opened(hp,t),form=compose(d,t),body='Uncertain '+fault+' '+marker,pattern=`**/requests/${t.id}/comments`;let posts=0;
    await hp.route(pattern,async route=>{posts++;const res=await route.fetch();assert.equal(res.status(),201);if(fault==='lost')return route.abort('failed');const envelope=await res.json();if(fault==='wrong-body')envelope.data.body='Substituted';if(fault==='wrong-visibility')envelope.data.visibility='PRIVATE_NOTE';await route.fulfill({response:res,body:JSON.stringify(envelope)});});
    try{await form.getByLabel('Conversation message',{exact:true}).fill(body);hp.once('dialog',x=>x.accept());await form.getByRole('button',{name:'Send reply',exact:true}).click();await form.getByText('The result could not be confirmed. Reload and check the current record before submitting again.',{exact:true}).waitFor();
      assert.equal(await form.getByLabel('Conversation message',{exact:true}).inputValue(),body);await d.getByRole('button',{name:'Close',exact:true}).click();await trigger(hp,t).click();await d.getByText(body,{exact:true}).first().waitFor();
      assert.equal(await compose(d,t).getByRole('button',{name:'Send reply',exact:true}).isDisabled(),true);assert.equal(await compose(d,t).getByRole('button',{name:'Prepare another message',exact:true}).count(),0);assert.equal(posts,1);assert.equal(await db.hRServiceComment.count({where:{tenantId,requestId:t.id}}),1);
    }finally{await hp.unroute(pattern);}
  });
  await check('an external write makes the displayed composer stale; server rejects with 409 and no extra message',hp,async()=>{
    const t=await fixture(),d=await opened(hp,t),form=compose(d,t);await form.getByLabel('Conversation message',{exact:true}).fill('Old draft');
    const external=await staff.request.post(origin+`/api/hr-service/requests/${t.id}/comments`,{headers:{origin},data:{body:'Independent writer',visibility:'REQUESTOR',expectedUpdatedAt:t.updatedAt.toISOString()}});assert.equal(external.status(),201);
    hp.once('dialog',x=>x.accept());const [response]=await Promise.all([hp.waitForResponse(r=>r.url().endsWith(`/requests/${t.id}/comments`)&&r.request().method()==='POST'),form.getByRole('button',{name:'Send reply',exact:true}).click()]);assert.equal(response.status(),409);
    await form.getByText('The request changed or is unavailable in this scope. Reload the current record.',{exact:true}).waitFor();assert.equal(await form.getByLabel('Conversation message',{exact:true}).inputValue(),'Old draft');assert.equal(await db.hRServiceComment.count({where:{tenantId,requestId:t.id}}),1);
  });
  await check('a reread preserves an unsent draft and demands explicit review before using the newer version',hp,async()=>{
    const t=await fixture(),d=await opened(hp,t);let form=compose(d,t);await form.getByLabel('Conversation message',{exact:true}).fill('Preserved after review');
    assert.equal((await staff.request.post(origin+`/api/hr-service/requests/${t.id}/comments`,{headers:{origin},data:{body:'Other update',visibility:'REQUESTOR',expectedUpdatedAt:t.updatedAt.toISOString()}})).status(),201);
    await refresh(d);await d.getByText('Other update',{exact:true}).waitFor();form=compose(d,t);assert.equal(await form.getByLabel('Conversation message',{exact:true}).inputValue(),'Preserved after review');assert.equal(await form.getByRole('button',{name:'Send reply',exact:true}).isDisabled(),true);
    await form.getByRole('button',{name:'Use reviewed conversation',exact:true}).click();await send(hp,d,t,'Preserved after review');assert.equal(await db.hRServiceComment.count({where:{tenantId,requestId:t.id}}),2);
  });
  await check('an independent newer message after confirmed save cannot rearm by merely refreshing',hp,async()=>{
    const t=await fixture(),d=await opened(hp,t);await send(hp,d,t,'My known reply');const current=await db.hRServiceRequest.findUniqueOrThrow({where:{id:t.id}});
    assert.equal((await staff.request.post(origin+`/api/hr-service/requests/${t.id}/comments`,{headers:{origin},data:{body:'Concurrent newer',expectedUpdatedAt:current.updatedAt.toISOString()}})).status(),201);
    await refresh(d);await d.getByText('Concurrent newer',{exact:true}).waitFor();assert.equal(await compose(d,t).getByRole('button',{name:'Prepare another message',exact:true}).isDisabled(),true);assert.equal(await db.hRServiceComment.count({where:{tenantId,requestId:t.id}}),2);
  });
  await check('older history page removes composer; latest page restores only the preserved draft',hp,async()=>{
    const t=await fixture();await db.hRServiceComment.createMany({data:Array.from({length:51},(_,i)=>({tenantId,requestId:t.id,authorId:staffId,body:'Older history '+i,visibility:'REQUESTOR'}))});
    const d=await opened(hp,t);await compose(d,t).getByLabel('Conversation message',{exact:true}).fill('Keep across history');await d.getByRole('button',{name:'Older messages',exact:true}).click();await d.getByText('Older messages are read-only. Refresh the latest messages before composing a reply.',{exact:true}).waitFor();assert.equal(await d.locator('textarea').count(),0);
    await refresh(d);await compose(d,t).getByLabel('Conversation message',{exact:true}).waitFor();assert.equal(await compose(d,t).getByLabel('Conversation message',{exact:true}).inputValue(),'Keep across history');
  });
  for(const status of ['CLOSED','CANCELLED'])await check(status+' conversation stays readable without a composer',hp,async()=>{const t=await fixture(status),d=await opened(hp,t);assert.equal(await d.locator('textarea,select').count(),0);});
  await check('employee reply in resolved conversation reopens the request with explicit consent',sp,async()=>{
    const t=await fixture('RESOLVED'),d=await opened(sp,t),form=compose(d,t);await form.getByLabel('Conversation message',{exact:true}).fill('Reopen from history');let confirmation;
    sp.once('dialog',x=>{confirmation=x.message();return x.accept();});await form.getByRole('button',{name:'Send reply',exact:true}).click();await form.getByText('The action was saved. You can check the current record.',{exact:true}).waitFor();assert.match(confirmation,/reopen/);
    assert.equal((await db.hRServiceRequest.findUniqueOrThrow({where:{id:t.id}})).status,'IN_PROGRESS');assert.equal(await db.hRServiceStatusTransition.count({where:{tenantId,requestId:t.id,toStatus:'IN_PROGRESS'}}),1);
  });
  await check('revoked session on POST clears previously displayed history without an automatic reread',hp,async()=>{
    const ctx=await context(staffId),p=await ctx.newPage(),t=await fixture();await add(t,'Sensitive old history','PRIVATE_NOTE');const d=await opened(p,t);await compose(d,t).getByLabel('Conversation message',{exact:true}).fill('Denied draft');await ctx.clearCookies();p.once('dialog',x=>x.accept());
    await compose(d,t).getByRole('button',{name:'Send reply',exact:true}).click();await d.getByText('The conversation could not be loaded. Access may have changed. Retry to read the latest page.',{exact:true}).waitFor();assert.ok(!(await d.innerText()).includes('Sensitive old history'));assert.equal(await d.locator('textarea').count(),0);assert.equal(await db.hRServiceComment.count({where:{tenantId,requestId:t.id}}),1);
    assert.equal((await ctx.request.post(origin+'/api/auth/local',{headers:{origin},data:{identifier:staffId,password}})).status(),200);
    await d.getByRole('button',{name:'Retry latest page',exact:true}).click();await d.getByText('Sensitive old history',{exact:true}).waitFor();
    assert.equal(await compose(d,t).getByRole('button',{name:'Send reply',exact:true}).isDisabled(),true);
  });
  for(const [locale,theme,width] of [['en','light',320],['en','dark',390],['tr','light',320],['tr','dark',390]])await check(`unified ${locale}/${theme}/${width}px reply composer, focus and visibility`,hp,async()=>{
    const ctx=await context(staffId,locale,theme,width),p=await ctx.newPage(),t=await fixture(),d=await opened(p,t,locale),form=compose(d,t);
    await form.getByLabel(label(locale,'Conversation message','Konuşma mesajı'),{exact:true}).fill('Synthetic mobile message '+marker);
    await form.getByLabel(label(locale,'Message visibility','Mesaj görünürlüğü'),{exact:true}).selectOption('PRIVATE_NOTE');
    const g=await d.evaluate(e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,width:innerWidth,scroll:e.scrollWidth,client:e.clientWidth,overflow:document.documentElement.style.getPropertyValue('overflow-y'),background:getComputedStyle(e).backgroundColor};});
    assert.ok(g.left>=0&&g.right<=width+1&&g.scroll<=g.client+2);assert.equal(g.overflow,'hidden');assert.match(g.background,/^rgb\(/);
    for(const key of ['Tab','Shift+Tab'])for(let i=0;i<25;i++){await p.keyboard.press(key);assert.ok(await d.evaluate(e=>e.contains(document.activeElement)));}
    await form.getByLabel(label(locale,'Conversation message','Konuşma mesajı'),{exact:true}).scrollIntoViewIfNeeded();const screenshot=await shot(p,`compose-${locale}-${theme}-${width}`);await p.keyboard.press('Escape');await d.waitFor({state:'hidden'});assert.ok(await trigger(p,t,locale).evaluate(e=>e===document.activeElement));return {screenshot,geometry:g};
  });
} finally {
  await Promise.all(contexts.map(ctx => ctx.close().catch(() => {}))); await browser.close();
  // Cleanup exact generated ids only. Audit fixtures remain in the disposable database.
  if (ticketIds.length) { await db.hRServiceComment.deleteMany({ where: { requestId: { in: ticketIds }, tenantId: { in: [tenantId, foreignTenant].filter(Boolean) } } }).catch(() => {}); await db.hRServiceRequest.deleteMany({ where: { id: { in: ticketIds } } }).catch(() => {}); }
  if (employmentId) await db.employment.deleteMany({ where: { id: employmentId, tenantId } }).catch(() => {});
  if (personId) await db.person.deleteMany({ where: { id: personId, tenantId } }).catch(() => {});
  await db.userAccount.deleteMany({ where: { id: { in: [selfId, staffId, peerId] }, tenantId } }).catch(() => {});
  if (foreignTenant) await db.tenant.deleteMany({ where: { id: foreignTenant } }).catch(() => {});
  await db.$disconnect(); report.summary = { tests: report.tests.length, passed: report.tests.filter(t => t.passed).length, failed: report.tests.filter(t => !t.passed).length };
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2)); console.log('CONVERSATION_SUMMARY ' + JSON.stringify(report.summary));
}
if (report.tests.length !== 20 || report.tests.some(t => !t.passed)) process.exitCode = 1;
