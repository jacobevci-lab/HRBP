import assert from 'node:assert/strict';
import { BenefitPlanType, PerformanceBand, PotentialBand } from '@prisma/client';
/** Additional real HTTP flows. All writes are restricted to the disposable audit database. */
export async function auditDomainFlows({ contexts, fixture, db, report, scenario, BASE, inventory }) {
  assert.equal(BASE, 'http://localhost:3100');
  const account = role => fixture.accounts.find(a => a.role === role);
  const employee = account('EMPLOYEE');
  const employment = await db.employment.findUnique({ where: { id: employee.employmentId } });
  const code = suffix => `${fixture.prefix}-${suffix}`.toUpperCase();
  const now = new Date(), day = n => new Date(now.getTime() + n * 86400000).toISOString();
  async function call(role, path, method = 'GET', body, expected = 200) {
    const context = contexts.get(role);
    assert.ok(context, `No authenticated ${role} context`);
    const response = await context.request.fetch(BASE + path, {
      method, timeout: 15000, maxRedirects: 0, headers: { origin: BASE }, ...(body === undefined ? {} : { data: body })
    });
    report.api.push({ path, method, role, test: 'domain-flow', http: response.status(), expected });
    const accepted = Array.isArray(expected) ? expected : [expected];
    assert.ok(accepted.includes(response.status()), `${role} ${method} ${path}: expected ${accepted}, received ${response.status()}`);
    return await response.json().catch(() => ({}));
  }
  const post = (role, path, body, expected = 201) => call(role, path, 'POST', body, expected);
  async function audited(resourceId) { assert.ok(await db.auditEvent.count({ where: { tenantId: fixture.tenantId, resourceId } }), 'Expected transaction audit evidence'); }
  await scenario('HR service: self-bound request, comment and outbox intent', async () => {
    const { data } = await post('EMPLOYEE', '/api/hr-service/requests', { category: 'AUDIT', title: 'Synthetic service request', description: 'Disposable test request only', subjectEmploymentId: account('MANAGER').employmentId });
    assert.equal(data.subjectEmploymentId, employee.employmentId);
    await post('EMPLOYEE', `/api/hr-service/requests/${data.id}/comments`, { body: 'Synthetic participant reply', visibility: 'INTERNAL' });
    const comments = await db.hRServiceComment.findMany({ where: { tenantId: fixture.tenantId, requestId: data.id } });
    assert.ok(comments.every(c => c.visibility === 'REQUESTOR'), 'Employee must not create internal staff notes');
    await audited(data.id);
    assert.ok(await db.notificationOutbox.count({ where: { tenantId: fixture.tenantId, resourceId: data.id } }));
  });
  await scenario('Leave: configuration, employee request, overlap rejection and cancellation', async () => {
    const { data: type } = await post('TIME_ADMIN', '/api/leave/types', { code: code('leave'), name: 'Synthetic audit leave', unit: 'DAYS', requiresApproval: true });
    const body = { employmentId: employee.employmentId, leaveTypeId: type.id, startsAt: day(10), endsAt: day(10), units: 1, reason: 'Synthetic audit leave request' };
    const { data: leave } = await post('EMPLOYEE', '/api/leave/requests', body);
    assert.equal(leave.status, 'PENDING');
    await post('EMPLOYEE', '/api/leave/requests', body, 409);
    await post('EMPLOYEE', `/api/leave/requests/${leave.id}/self-cancel`, {}, 200);
    assert.equal((await db.leaveRequest.findUnique({ where: { id: leave.id } })).status, 'CANCELLED');
    await audited(leave.id);
  });
  await scenario('Time: schedule creation, self entry, duplicate prevention', async () => {
    const { data: schedule } = await post('TIME_ADMIN', '/api/time/schedules', { code: code('schedule'), name: 'Synthetic audit schedule', timezone: 'Europe/Istanbul', weeklyMinutes: 2400, effectiveFrom: day(-2) });
    const body = { employmentId: employee.employmentId, workDate: day(-1).slice(0,10), minutes: 480, overtimeMinutes: 0, source: 'PRODUCT_AUDIT' };
    const { data: entry } = await post('EMPLOYEE', '/api/time/entries', body);
    assert.equal(entry.status, 'DRAFT');
    await post('EMPLOYEE', '/api/time/entries', body, 409);
    await audited(schedule.id); await audited(entry.id);
  });
  await scenario('Benefits: plan and pending employee enrollment', async () => {
    const { data: plan } = await post('HR_OPERATIONS', '/api/benefits/plans', { code: code('benefit'), name: 'Synthetic audit benefit', type: Object.values(BenefitPlanType)[0], effectiveFrom: day(-1), currency: 'TRY' });
    const { data: enrollment } = await post('HR_OPERATIONS', '/api/benefits/enrollments', { employmentId: employee.employmentId, benefitPlanId: plan.id, effectiveFrom: day(1), coverageTier: 'EMPLOYEE' });
    assert.equal(enrollment.status, 'PENDING'); await audited(enrollment.id);
  });
  await scenario('Performance: draft cycle and governed employee goal', async () => {
    const { data: cycle } = await post('TALENT_ADMIN', '/api/performance/cycles', { name: code('review'), startsAt: day(-1), endsAt: day(60) });
    assert.equal(cycle.status, 'DRAFT');
    const { data: goal } = await post('TALENT_ADMIN', '/api/performance/goals', { employmentId: employee.employmentId, title: 'Synthetic audit goal', startsAt: day(0), dueAt: day(30), progress: 0 });
    await audited(cycle.id); await audited(goal.id);
  });
  await scenario('Talent: human-authored assessment persists with audit', async () => {
    const { data } = await post('TALENT_ADMIN', '/api/talent/assessments', { employmentId: employee.employmentId, cycleLabel: code('talent'), performance: Object.values(PerformanceBand)[0], potential: Object.values(PotentialBand)[0] });
    await audited(data.id);
  });
  await scenario('Learning: skill, course, assignment, employee start and completion', async () => {
    const { data: skill } = await post('TALENT_ADMIN', '/api/learning/skills', { code: code('skill'), name: 'Synthetic audit skill', critical: false });
    const { data: course } = await post('TALENT_ADMIN', '/api/learning/courses', { code: code('course'), title: 'Synthetic audit course', mandatory: false });
    const { data: assignment } = await post('TALENT_ADMIN', '/api/learning/assignments', { employmentId: employee.employmentId, courseId: course.id, dueAt: day(30) });
    await post('EMPLOYEE', `/api/learning/assignments/${assignment.id}/self-transition`, { status: 'COMPLETED' }, 409);
    await post('EMPLOYEE', `/api/learning/assignments/${assignment.id}/self-transition`, { status: 'IN_PROGRESS' }, 200);
    await post('EMPLOYEE', `/api/learning/assignments/${assignment.id}/self-transition`, { status: 'COMPLETED' }, 200);
    assert.equal((await db.learningAssignment.findUnique({ where: { id: assignment.id } })).status, 'COMPLETED');
    assert.equal(await db.employmentSkill.count({ where: { employmentId: employee.employmentId, skillId: skill.id } }), 0, 'Course completion must not invent verified skill proficiency');
    await audited(assignment.id);
  });
  await scenario('Engagement: survey and owned question authoring', async () => {
    const { data: survey } = await post('HR_OPERATIONS', '/api/engagement/surveys', { code: code('survey'), name: 'Synthetic listening survey' });
    const { data: question } = await post('HR_OPERATIONS', `/api/engagement/surveys/${survey.id}/questions`, { questionKey: 'AUDIT_Q1', prompt: 'Synthetic test question', type: 'SINGLE_CHOICE', options: ['Option A','Option B'], required: true });
    await audited(question.id);
  });
  await scenario('Policy: draft, independent approval, publication', async () => {
    const { data } = await post('LEGAL', '/api/policies', { code: code('policy'), title: 'Synthetic audit policy', version: '1.0', contentMarkdown: 'Disposable policy content. Not a customer policy.', effectiveFrom: day(-1), reviewDueAt: day(30) });
    await post('LEGAL', `/api/policies/${data.id}/review`, { action: 'SUBMIT' }, 200);
    await post('LEGAL', `/api/policies/${data.id}/review`, { action: 'APPROVE' }, 403);
    await post('HR_OPERATIONS', `/api/policies/${data.id}/review`, { action: 'APPROVE' }, 200);
    await post('HR_OPERATIONS', `/api/policies/${data.id}/publish`, {}, 200);
    assert.equal((await db.policyRecord.findUnique({ where: { id: data.id } })).status, 'PUBLISHED'); await audited(data.id);
  });
  await scenario('Workflow: definition creation and independent activation', async () => {
    const { data } = await post('TENANT_ADMIN', '/api/workflows/definitions', { key: code('workflow'), name: 'Synthetic audit workflow', triggerType: 'MANUAL', steps: [{ stepKey: 'review', name: 'Human review', actionType: 'APPROVAL', assigneeRole: 'HR_OPERATIONS', slaMinutes: 60 }] });
    await post('TENANT_ADMIN', `/api/workflows/definitions/${data.id}/lifecycle`, { action: 'ACTIVATE' }, 403);
    await post('HR_OPERATIONS', `/api/workflows/definitions/${data.id}/lifecycle`, { action: 'ACTIVATE' }, 200);
    assert.equal((await db.workflowDefinition.findUnique({ where: { id: data.id } })).status, 'ACTIVE'); await audited(data.id);
  });
  await scenario('Privacy: subject-bound DSR intake', async () => {
    const { data } = await post('PRIVACY_OFFICER', '/api/privacy/dsrs', { subjectPersonId: employment.personId, type: 'ACCESS', channel: 'PRODUCT_AUDIT', dueAt: day(30) });
    assert.equal(data.subjectPersonId, employment.personId); assert.equal(data.status, 'RECEIVED'); await audited(data.id);
  });
  await scenario('Employee Relations: case creation and case-wall denial', async () => {
    const { data } = await post('ER_INVESTIGATOR', '/api/employee-relations/cases', { caseType: 'PRODUCT_AUDIT', title: 'Synthetic restricted case', subjectPersonId: employment.personId });
    assert.equal(data.classification, 'HIGHLY_RESTRICTED');
    await call('TENANT_ADMIN', '/api/employee-relations/cases', 'GET', undefined, 403);
    const legal = await call('LEGAL', '/api/employee-relations/cases');
    assert.ok(!JSON.stringify(legal.data).includes(data.id), 'Unassigned legal user must not see the new case'); await audited(data.id);
  });
  await scenario('Documents: metadata intake without inventing a stored file', async () => {
    const { data, next } = await post('HR_OPERATIONS', '/api/documents', { fileName: 'synthetic-audit.txt', contentType: 'text/plain', personId: employment.personId });
    assert.ok(data.id); assert.equal(next.scanRequired, true); await audited(data.id);
    assert.equal(await db.documentVersion.count({ where: { tenantId: fixture.tenantId, documentId: data.id } }), 0);
  });
  await scenario('Workforce Planning: scenario draft with bounded planning horizon', async () => {
    const { data } = await post('HR_OPERATIONS', '/api/workforce-planning/scenarios', { code: code('scenario'), name: 'Synthetic audit scenario', baseDate: day(0), currency: 'TRY', horizonMonths: 12 });
    await audited(data.id);
  });
  await scenario('Compensation: proposal draft cannot silently alter salary history', async () => {
    const before = await db.compensationHistory.count({ where: { employmentId: employee.employmentId } });
    const { data } = await post('COMPENSATION_ADMIN', '/api/compensation/changes', { employmentId: employee.employmentId, currency: 'TRY', proposedAnnualBase: '1200000.00', effectiveAt: day(10), reason: 'Synthetic compensation proposal' });
    assert.equal(data.status, 'DRAFT'); assert.equal(await db.compensationHistory.count({ where: { employmentId: employee.employmentId } }), before); await audited(data.id);
  });
  await scenario('Payroll: country pack, period, draft run and duplicate prevention', async () => {
    const { data: pack } = await post('PAYROLL_ADMIN', '/api/payroll/country-packs', { countryCode: 'TR', name: 'Synthetic audit pack, not statutory calculation', version: code('pack'), currency: 'TRY', effectiveFrom: day(-1) });
    const { data: period } = await post('PAYROLL_ADMIN', '/api/payroll/periods', { countryPackId: pack.id, code: code('period'), startsAt: day(1), endsAt: day(28), payDate: day(30) });
    const { data: run } = await post('PAYROLL_ADMIN', '/api/payroll/runs', { payrollPeriodId: period.id });
    assert.equal(run.status, 'DRAFT'); await post('PAYROLL_ADMIN', '/api/payroll/runs', { payrollPeriodId: period.id }, 409); await audited(run.id);
  });
  await scenario('Recruiting: owned draft requisition', async () => {
    const { data } = await post('RECRUITER', '/api/recruiting/requisitions', { title: 'Synthetic audit vacancy', openings: 1, recruiterId: account('RECRUITER').id, hiringManagerId: account('MANAGER').id, targetHireDate: day(30) });
    assert.equal(data.status, 'DRAFT'); await audited(data.id);
  });
  await scenario('Succession: position-centric governed plan', async () => {
    const { data: position } = await post('TENANT_ADMIN', '/api/positions', { positionCode: code('succ'), title: 'Synthetic succession seat', orgUnitId: 'org-engineering' });
    const { data } = await post('TALENT_ADMIN', '/api/succession/plans', { positionId: position.id, name: 'Synthetic succession plan', reviewDueAt: day(30) });
    assert.equal(data.positionId, position.id); await audited(data.id);
  });
  await scenario('Offboarding: controlled creation, duplicate rejection and non-terminating cancellation', async () => {
    const body = { employmentId: employee.employmentId, type: 'RESIGNATION', noticeDate: day(0), lastWorkingDate: day(30), employeeReason: 'Synthetic disposable exit' };
    const { data } = await post('HR_OPERATIONS', '/api/offboarding/processes', body);
    await post('HR_OPERATIONS', '/api/offboarding/processes', body, 409);
    await post('HR_OPERATIONS', `/api/offboarding/processes/${data.id}/cancel`, { reason: 'Synthetic audit cancellation; no real employee exit' }, 200);
    assert.equal((await db.employment.findUnique({ where: { id: employee.employmentId } })).status, 'ACTIVE'); await audited(data.id);
  });
  await scenario('Old session rejected after account is deactivated', async () => {
    const subject = account('RECRUITER');
    await db.userAccount.update({ where: { id: subject.id }, data: { active: false } });
    try { await call('RECRUITER', '/api/people', 'GET', undefined, 401); }
    finally { await db.userAccount.update({ where: { id: subject.id }, data: { active: true } }); }
  });
  const readRole = path => path.includes('/audit') ? 'SECURITY_AUDITOR' : path.startsWith('/api/payroll') ? 'PAYROLL_ADMIN' : path.startsWith('/api/compensation') ? 'COMPENSATION_ADMIN' : path.startsWith('/api/privacy') ? 'PRIVACY_OFFICER' : path.startsWith('/api/employee-relations') ? 'ER_INVESTIGATOR' : /^\/api\/(performance|talent|succession|learning)/.test(path) ? 'TALENT_ADMIN' : path.startsWith('/api/settings') ? 'TENANT_ADMIN' : 'HR_OPERATIONS';
  for (const route of inventory.apis.filter(r => r.methods.includes('GET') && !r.path.includes('[') && !/^\/api\/(auth|health|internal)\//.test(r.path))) {
    await scenario(`Authenticated read ${route.path}`, async () => {
      const role = readRole(route.path), response = await contexts.get(role).request.get(BASE + route.path, { timeout: 15000, maxRedirects: 0 });
      report.api.push({ path: route.path, method: 'GET', role, test: 'authenticated-read', http: response.status() });
      assert.ok(response.status() < 500, `Unexpected HTTP ${response.status()}`);
    });
  }
}
