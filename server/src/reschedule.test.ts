import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvals, assets, auditEvents, budgetLines, confirmDeliveryReschedule, contracts,
  previewDeliveryReschedule, projectSummary, projects, resetDemoState, RescheduleError,
  setDependencyCalculationFailure,
} from './domain.js';

const DAY_MS = 86400000;
const iso = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
const addDays = (value: string, days: number) => new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

function expectError(statusCode: number, fn: () => unknown, messageIncludes?: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof RescheduleError, '应当抛出 RescheduleError');
    assert.equal(error.statusCode, statusCode);
    if (messageIncludes) assert.match(error.message, new RegExp(messageIncludes));
    return true;
  });
}

test.beforeEach(() => { resetDemoState(); });

test('预览只生成影响清单：合同里程碑、授权窗口、审批与预算风险齐全，且不修改任何数据', () => {
  const before = projects.find(p => p.id === 'PRJ-001')!;
  const milestoneBefore = contracts.find(c => c.id === 'CTR-01')!.milestones.find(m => m.name === '母版验收')!.due;
  const auditBefore = auditEvents.length;
  const preview = previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: iso(50), reason: '海外平台排播窗口后移 6 天' });

  assert.equal(preview.oldDate, before.deliveryDate);
  assert.equal(preview.deltaDays, 6);
  assert.equal(preview.blocking, false);
  assert.ok(preview.milestoneImpacts.some(m => m.milestone === '母版验收' && m.newDue === addDays(milestoneBefore, 6)));
  assert.ok(preview.milestoneImpacts.some(m => m.status === 'invoiced' && m.severity === 'warning'));
  assert.ok(preview.assetWindowImpacts.some(a => a.assetId === 'AST-003'));
  assert.ok(preview.approvalImpacts.some(a => a.approvalId === 'APR-02' && a.newStatus === null));
  assert.ok(preview.budgetImpacts.some(b => b.lineId === 'BL-101' && b.oldRisk === 'medium' && b.newRisk === 'high'));
  assert.match(preview.fingerprint, /^fp-/);
  // 预览不落地
  assert.equal(projects.find(p => p.id === 'PRJ-001')!.deliveryDate, before.deliveryDate);
  assert.equal(contracts.find(c => c.id === 'CTR-01')!.milestones.find(m => m.name === '母版验收')!.due, milestoneBefore);
  assert.equal(auditEvents.length, auditBefore);
});

test('确认后一次性生效：日期、里程碑、授权窗口、审批与预算全部更新，审计含旧/新日期、理由与影响快照；各页面读到同一日期', () => {
  const oldDate = projects.find(p => p.id === 'PRJ-001')!.deliveryDate;
  const preview = previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: iso(50), reason: '海外平台排播窗口后移 6 天' });
  const result = confirmDeliveryReschedule({ previewId: preview.previewId, actor: '制片协调人A' });

  assert.equal(result.oldDate, oldDate);
  assert.equal(result.newDate, iso(50));
  const project = projects.find(p => p.id === 'PRJ-001')!;
  assert.equal(project.deliveryDate, iso(50));
  assert.equal(contracts.find(c => c.id === 'CTR-01')!.milestones.find(m => m.name === '母版验收')!.due, iso(42));
  assert.equal(assets.find(a => a.id === 'AST-003')!.availableTo, iso(58));
  assert.equal(budgetLines.find(l => l.id === 'BL-101')!.risk, 'high');
  // 资产审批保留挂起（仅警示），交付审批才会失效
  assert.equal(approvals.find(a => a.id === 'APR-02')!.status, 'pending');

  const summary = projectSummary('PRJ-001');
  assert.equal(summary.project!.deliveryDate, project.deliveryDate); // 刷新后驾驶舱/预算/版权页共享同一日期

  const audit = auditEvents.find(e => e.id === result.auditId)!;
  assert.equal(audit.action, 'RESCHEDULE_DELIVERY');
  assert.equal(audit.snapshot!.oldDate, oldDate);
  assert.equal(audit.snapshot!.newDate, iso(50));
  assert.equal(audit.snapshot!.reason, '海外平台排播窗口后移 6 天');
  assert.equal(audit.snapshot!.actor, '制片协调人A');
  assert.ok(audit.snapshot!.milestoneImpacts.length >= 2);
  assert.ok(audit.snapshot!.assetWindowImpacts.some(a => a.assetId === 'AST-003' && a.newAvailableTo === iso(58)));
});

test('日期倒退默认阻断：预览清单给出阻断项、确认被拒；显式允许倒退后可确认且操作被审计', () => {
  const blocked = previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: iso(10), reason: '节展提前' });
  assert.equal(blocked.deltaDays, -34);
  assert.equal(blocked.blocking, true);
  assert.ok(blocked.blockers.some(b => b.includes('日期倒退')));
  expectError(422, () => confirmDeliveryReschedule({ previewId: blocked.previewId }), '阻断');
  assert.equal(projects.find(p => p.id === 'PRJ-001')!.deliveryDate, blocked.oldDate);

  const preview = previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: iso(10), reason: '节展提前', allowBackward: true });
  assert.equal(preview.deltaDays, -34);
  assert.equal(preview.blocking, false);
  const result = confirmDeliveryReschedule({ previewId: preview.previewId });
  assert.equal(projects.find(p => p.id === 'PRJ-001')!.deliveryDate, iso(10));
  assert.equal(result.snapshot.allowBackward, true);
  assert.match(auditEvents[0].details, /提前 34 天/);
});

test('后移跨过授权到期时产生 critical 阻断；阻断项未解除前不能确认，授权不会被悄悄延期', () => {
  const audio = assets.find(a => a.id === 'AST-003')!;
  const preview = previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: iso(120), reason: '海外窗口整体后移一季节' });
  const impact = preview.assetWindowImpacts.find(a => a.assetId === 'AST-003')!;
  assert.equal(impact.severity, 'critical');
  assert.match(impact.note, /跨过授权到期/);
  assert.ok(preview.blocking);
  assert.ok(preview.blockers.some(b => b.includes('跨过授权到期')));
  expectError(422, () => confirmDeliveryReschedule({ previewId: preview.previewId }), '阻断');
  assert.equal(assets.find(a => a.id === 'AST-003')!.availableTo, audio.availableTo);
  assert.equal(projects.find(p => p.id === 'PRJ-001')!.deliveryDate, preview.oldDate);
});

test('授权在当前交付日前已到期的资产无法靠后移自动续期，必须续签（critical）', () => {
  assets.find(a => a.id === 'AST-002')!.availableTo = iso(20); // 早于旧交付日 iso(44)
  const preview = previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: iso(50), reason: '窗口后移' });
  const impact = preview.assetWindowImpacts.find(a => a.assetId === 'AST-002')!;
  assert.equal(impact.severity, 'critical');
  assert.equal(impact.newAvailableTo, null);
  assert.match(impact.note, /已到期/);
  assert.ok(preview.blocking);
});

test('已交付项目不能调整交付日（预览与确认都拒绝）', () => {
  const project = projects.find(p => p.id === 'PRJ-002')!;
  project.status = 'delivered';
  expectError(422, () => previewDeliveryReschedule({ projectId: 'PRJ-002', newDate: iso(200), reason: 'x' }), '已交付');
});

test('并发确认：预览令牌一次性使用，重复确认被拒绝', () => {
  const preview = previewDeliveryReschedule({ projectId: 'PRJ-002', newDate: iso(140), reason: '海外排播后移两周' });
  confirmDeliveryReschedule({ previewId: preview.previewId });
  expectError(409, () => confirmDeliveryReschedule({ previewId: preview.previewId }), '已被确认');
});

test('并发确认：预览后交付日被其他操作改动，确认拒绝并要求重新预览', () => {
  const preview = previewDeliveryReschedule({ projectId: 'PRJ-002', newDate: iso(140), reason: '海外排播后移两周' });
  projects.find(p => p.id === 'PRJ-002')!.deliveryDate = iso(130); // 模拟并发修改
  expectError(409, () => confirmDeliveryReschedule({ previewId: preview.previewId }), '并发');
});

test('并发确认：预览后合同里程碑被改动，重算指纹不一致则拒绝且数据不变', () => {
  const oldDate = projects.find(p => p.id === 'PRJ-002')!.deliveryDate;
  const preview = previewDeliveryReschedule({ projectId: 'PRJ-002', newDate: iso(140), reason: '海外排播后移两周' });
  contracts.find(c => c.id === 'CTR-03')!.milestones[0].due = iso(25); // 预览后供应商改了账期
  expectError(409, () => confirmDeliveryReschedule({ previewId: preview.previewId }), '不一致');
  assert.equal(projects.find(p => p.id === 'PRJ-002')!.deliveryDate, oldDate);
});

test('依赖计算失败：返回 503，本次不产生任何变更，故障标志一次性消费后可重试', () => {
  const oldDate = projects.find(p => p.id === 'PRJ-001')!.deliveryDate;
  const auditBefore = auditEvents.length;
  setDependencyCalculationFailure(true);
  expectError(503, () => previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: iso(50), reason: '窗口后移' }), '依赖计算失败');
  assert.equal(projects.find(p => p.id === 'PRJ-001')!.deliveryDate, oldDate);
  assert.equal(auditEvents.length, auditBefore);
  // 依赖恢复后同一请求可以重新预览并确认
  const retry = previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: iso(50), reason: '窗口后移' });
  assert.equal(retry.deltaDays, 6);
  confirmDeliveryReschedule({ previewId: retry.previewId });
  assert.equal(projects.find(p => p.id === 'PRJ-001')!.deliveryDate, iso(50));
});

test('重复提交：相同幂等键回放首次结果，不重复改日期也不重复写审计', () => {
  const preview = previewDeliveryReschedule({ projectId: 'PRJ-002', newDate: iso(140), reason: '海外排播后移两周' });
  const first = confirmDeliveryReschedule({ previewId: preview.previewId, idempotencyKey: 'idem-key-1' });
  // 网络重试：即使携带另一个（已失效的）预览令牌，也直接回放首次结果
  const second = confirmDeliveryReschedule({ previewId: 'another-preview', idempotencyKey: 'idem-key-1' });
  assert.equal(second.auditId, first.auditId);
  assert.equal(projects.find(p => p.id === 'PRJ-002')!.deliveryDate, iso(140)); // 没有再后移一次
  assert.equal(auditEvents.filter(e => e.action === 'RESCHEDULE_DELIVERY' && e.entityId === 'PRJ-002').length, 1);
});

test('缺少理由或日期非法时返回 400；不存在的预览返回 404', () => {
  expectError(400, () => previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: iso(50), reason: '   ' }), '理由');
  expectError(400, () => previewDeliveryReschedule({ projectId: 'PRJ-001', newDate: '2026-13-40', reason: 'x' }), '日期');
  expectError(404, () => confirmDeliveryReschedule({ previewId: 'RSH-P9999' }), '预览不存在');
  expectError(404, () => previewDeliveryReschedule({ projectId: 'PRJ-X', newDate: iso(50), reason: 'x' }), '项目不存在');
});
