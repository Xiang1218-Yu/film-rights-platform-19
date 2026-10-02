import test from 'node:test';
import assert from 'node:assert/strict';
import { contracts, projectSummary, projects } from './domain.js';
import { auditEvents } from './domain.js';
import {
  RescheduleError,
  cancelReschedule,
  confirmReschedule,
  previewReschedule,
  projectRescheduleAudit,
} from './reschedule.js';

const P1 = 'PRJ-001';
const P2 = 'PRJ-002';
const baselineDate = projects.find(p => p.id === P1)!.deliveryDate;
const p2BaselineStatus = projects.find(p => p.id === P2)!.status;
const reason = '海外发行窗口调整，平台要求交付日后移';
const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

function restoreBaseline() {
  const p1 = projects.find(p => p.id === P1)!;
  const p2 = projects.find(p => p.id === P2)!;
  p1.deliveryDate = baselineDate;
  p2.status = p2BaselineStatus;
}

test('预览只生成影响清单：覆盖合同里程碑、授权窗口、在途审批与预算，不改任何数据', () => {
  const before = projectSummary(P1);
  const ctr01 = contracts.find(c => c.id === 'CTR-01')!;
  const tempMilestone = { name: '海外介质交付', due: iso(50), amount: 800000, status: 'open' as const };
  ctr01.milestones.push(tempMilestone);
  try {
    const preview = previewReschedule({ projectId: P1, newDate: iso(60), reason });
    assert.equal(preview.direction, 'postpone');
    assert.equal(preview.canConfirm, true);
    assert.ok(preview.impacts.some(i => i.category === 'asset' && i.severity === 'critical' && i.title.includes('跨越授权到期')), '应识别跨越授权到期的资产');
    assert.ok(preview.impacts.some(i => i.category === 'approval'), '应列出在途审批影响');
    assert.ok(preview.impacts.some(i => i.category === 'budget'), '应列出预算风险');
    assert.ok(preview.impacts.some(i => i.category === 'contract' && i.detail.includes('海外介质交付')), '应列出合同里程碑影响');
    // 预览不改变交付日
    assert.equal(projectSummary(P1).project!.deliveryDate, before.project!.deliveryDate);
  } finally {
    ctr01.milestones.splice(ctr01.milestones.indexOf(tempMilestone), 1);
  }
});

test('确认后一次性生效：交付日更新，审计记录旧/新日期、理由与影响快照', () => {
  try {
    const newDate = iso(64);
    const preview = previewReschedule({ projectId: P1, newDate, reason });
    const result = confirmReschedule({ token: preview.token });
    assert.equal(result.applied, true);
    assert.equal(result.deliveryDate, newDate);
    assert.equal(projectSummary(P1).project!.deliveryDate, newDate, '各页面共用同一份项目数据，刷新后日期一致');
    assert.equal(result.snapshot.oldDate, baselineDate);
    assert.equal(result.snapshot.newDate, newDate);
    assert.equal(result.snapshot.reason, reason);
    assert.ok(result.snapshot.impacts.length >= 1);
    const audit = projectRescheduleAudit(P1).find(e => e.id === result.auditId);
    assert.ok(audit, '审计事件可按项目检索');
    assert.equal(audit!.oldDate, baselineDate);
    assert.equal(audit!.newDate, newDate);
  } finally {
    restoreBaseline();
  }
});

test('日期倒退：预览标记需显式知悉，未勾选被拒绝，勾选后生效', () => {
  try {
    const preview = previewReschedule({ projectId: P1, newDate: iso(20), reason: '窗口收紧需提前交付' });
    assert.equal(preview.direction, 'advance');
    assert.equal(preview.requiresRegressionAck, true);
    assert.ok(preview.impacts.some(i => i.severity === 'warning' && i.title === '交付日倒退'));
    assert.throws(
      () => confirmReschedule({ token: preview.token }),
      (error: unknown) => error instanceof RescheduleError && error.code === 'regression_ack_required',
    );
    const result = confirmReschedule({ token: preview.token, confirmRegression: true });
    assert.equal(result.applied, true);
    assert.equal(projects.find(p => p.id === P1)!.deliveryDate, iso(20));
  } finally {
    restoreBaseline();
  }
});

test('跨过授权到期：后移到授权截止之后产生 critical 影响', () => {
  // AST-003 授权截止为 today+52 天
  const preview = previewReschedule({ projectId: P1, newDate: iso(56), reason });
  const expiryImpact = preview.impacts.find(i => i.category === 'asset' && i.title.includes('跨越授权到期'));
  assert.ok(expiryImpact);
  assert.equal(expiryImpact!.severity, 'critical');
  assert.ok(expiryImpact!.detail.includes('AST-003'));
});

test('已交付项目：预览带 blocker 且不能确认', () => {
  try {
    const p2 = projects.find(p => p.id === P2)!;
    p2.status = 'delivered';
    const preview = previewReschedule({ projectId: P2, newDate: iso(200), reason });
    assert.equal(preview.canConfirm, false);
    assert.ok(preview.impacts.some(i => i.severity === 'blocker' && i.title.includes('已交付')));
    assert.throws(
      () => confirmReschedule({ token: preview.token }),
      (error: unknown) => error instanceof RescheduleError && error.code === 'blocked',
    );
    assert.equal(projects.find(p => p.id === P2)!.deliveryDate, projectSummary(P2).project!.deliveryDate);
  } finally {
    restoreBaseline();
  }
});

test('并发确认：后生成的预览使旧票据失效，确认旧票据返回 409', () => {
  try {
    const stale = previewReschedule({ projectId: P1, newDate: iso(70), reason: '旧的改期方案' });
    const fresh = previewReschedule({ projectId: P1, newDate: iso(80), reason: '新的改期方案' });
    assert.throws(
      () => confirmReschedule({ token: stale.token }),
      (error: unknown) => error instanceof RescheduleError && error.code === 'preview_superseded',
    );
    const result = confirmReschedule({ token: fresh.token });
    assert.equal(result.applied, true);
    assert.equal(projects.find(p => p.id === P1)!.deliveryDate, iso(80));
  } finally {
    restoreBaseline();
  }
});

test('并发确认：预览后依赖数据被第三方改动，乐观锁拒绝生效', () => {
  const preview = previewReschedule({ projectId: P1, newDate: iso(66), reason });
  const target = contracts.find(c => c.id === 'CTR-01')!.milestones[0];
  const originalStatus = target.status;
  try {
    target.status = 'paid'; // 模拟预览后另一会话完成了里程碑付款
    assert.throws(
      () => confirmReschedule({ token: preview.token }),
      (error: unknown) => error instanceof RescheduleError && error.code === 'state_changed',
    );
    assert.equal(projects.find(p => p.id === P1)!.deliveryDate, baselineDate, '状态漂移时交付日不得被修改');
  } finally {
    target.status = originalStatus;
  }
});

test('依赖计算失败：里程碑日期损坏时预览中止且不写任何变更', () => {
  const target = contracts.find(c => c.id === 'CTR-01')!;
  const milestone = target.milestones.find(m => m.name === '锁剪交付')!;
  const originalDue = milestone.due;
  try {
    milestone.due = 'not-a-date';
    assert.throws(
      () => previewReschedule({ projectId: P1, newDate: iso(60), reason }),
      (error: unknown) => error instanceof RescheduleError && error.code === 'dependency_failed',
    );
    assert.equal(projects.find(p => p.id === P1)!.deliveryDate, baselineDate);
  } finally {
    milestone.due = originalDue;
  }
});

test('重复提交：同一票据确认两次只生效一次，第二次幂等返回', () => {
  try {
    const newDate = iso(72);
    const preview = previewReschedule({ projectId: P1, newDate, reason });
    const auditBefore = auditEvents.filter(e => e.action === 'RESCHEDULE_DELIVERY' && e.entityId === P1).length;
    const first = confirmReschedule({ token: preview.token });
    const second = confirmReschedule({ token: preview.token });
    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.alreadyConfirmed, true);
    assert.equal(second.auditId, first.auditId);
    const auditAfter = auditEvents.filter(e => e.action === 'RESCHEDULE_DELIVERY' && e.entityId === P1).length;
    assert.equal(auditAfter, auditBefore + 1, '重复提交不得重复写审计');
    assert.equal(projects.find(p => p.id === P1)!.deliveryDate, newDate);
  } finally {
    restoreBaseline();
  }
});

test('无效票据、缺失理由、相同日期均被拒绝', () => {
  assert.throws(
    () => confirmReschedule({ token: 'no-such-token' }),
    (error: unknown) => error instanceof RescheduleError && error.code === 'preview_not_found',
  );
  assert.throws(
    () => previewReschedule({ projectId: P1, newDate: iso(60), reason: '' }),
    (error: unknown) => error instanceof RescheduleError && error.code === 'reason_required',
  );
  assert.throws(
    () => previewReschedule({ projectId: P1, newDate: baselineDate, reason }),
    (error: unknown) => error instanceof RescheduleError && error.code === 'same_date',
  );
  assert.throws(
    () => previewReschedule({ projectId: P1, newDate: '2026/03/01', reason }),
    (error: unknown) => error instanceof RescheduleError && error.code === 'invalid_date',
  );
});

test('取消预览后票据不可再确认', () => {
  const preview = previewReschedule({ projectId: P1, newDate: iso(60), reason });
  cancelReschedule(preview.token);
  assert.throws(
    () => confirmReschedule({ token: preview.token }),
    (error: unknown) => error instanceof RescheduleError && error.code === 'preview_not_found',
  );
});
