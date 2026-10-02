import { randomUUID } from 'node:crypto';
import { approvals, assets, auditEvents, budgetLines, contracts, projects } from './domain.js';

export type ImpactSeverity = 'blocker' | 'critical' | 'warning' | 'info';
export type ImpactCategory = 'project' | 'contract' | 'asset' | 'approval' | 'budget';

export interface ImpactItem {
  category: ImpactCategory;
  severity: ImpactSeverity;
  title: string;
  detail: string;
  refId: string;
}

export class RescheduleError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export interface ReschedulePreview {
  token: string;
  projectId: string;
  oldDate: string;
  newDate: string;
  reason: string;
  requestedBy: string;
  direction: 'postpone' | 'advance';
  deltaDays: number;
  canConfirm: boolean;
  requiresRegressionAck: boolean;
  impacts: ImpactItem[];
  impactCounts: Record<ImpactSeverity, number>;
  expiresAt: string;
}

interface PreviewRecord extends Omit<ReschedulePreview, 'expiresAt'> {
  expiresAtMs: number;
  fingerprint: string;
  status: 'open' | 'consumed' | 'superseded' | 'cancelled';
  confirmedAt?: string;
  auditId?: string;
}

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const previews = new Map<string, PreviewRecord>();
const DAY_MS = 86400000;

const cny = (n: number) => `¥${(n / 10000).toFixed(1)}万`;

function parseDate(value: string, field: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RescheduleError(400, `${field}必须为 YYYY-MM-DD 格式`, 'invalid_date');
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new RescheduleError(400, `${field}不是有效日期`, 'invalid_date');
  return d;
}

/** 依赖数据上的任何日期字段无法解析时，视为依赖计算失败，而不是静默跳过。 */
function parseDependencyDate(value: string, ref: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RescheduleError(422, `依赖计算失败：${ref} 的日期字段损坏（${String(value)}），已中止改期评估`, 'dependency_failed');
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new RescheduleError(422, `依赖计算失败：${ref} 的日期无法解析，已中止改期评估`, 'dependency_failed');
  }
  return d;
}

/** 当前状态指纹：确认时若与预览时不一致，拒绝生效（乐观锁）。 */
export function stateFingerprint(projectId: string): string {
  const project = projects.find(item => item.id === projectId);
  if (!project) throw new RescheduleError(404, '项目不存在', 'project_not_found');
  return JSON.stringify({
    p: [project.status, project.deliveryDate],
    m: contracts
      .filter(c => c.projectId === projectId)
      .flatMap(c => c.milestones.map(m => [c.id, m.name, m.due, m.status, m.amount])),
    a: assets.filter(a => a.projectId === projectId).map(a => [a.id, a.status, a.availableFrom, a.availableTo]),
    r: approvals.filter(r => r.projectId === projectId).map(r => [r.id, r.status]),
  });
}

interface Evaluation {
  impacts: ImpactItem[];
  direction: 'postpone' | 'advance';
  deltaDays: number;
  requiresRegressionAck: boolean;
}

function evaluate(projectId: string, newDateInput: string): Evaluation {
  const project = projects.find(item => item.id === projectId);
  if (!project) throw new RescheduleError(404, '项目不存在', 'project_not_found');
  const newDate = parseDate(newDateInput, 'newDate').toISOString().slice(0, 10);
  const oldDate = project.deliveryDate;
  parseDependencyDate(oldDate, `项目 ${project.code} 的当前交付日`);
  if (newDate === oldDate) throw new RescheduleError(400, '新交付日与当前交付日相同，无需改期', 'same_date');

  const direction: Evaluation['direction'] = newDate > oldDate ? 'postpone' : 'advance';
  const deltaDays = Math.round(
    (new Date(`${newDate}T00:00:00Z`).getTime() - new Date(`${oldDate}T00:00:00Z`).getTime()) / DAY_MS,
  );
  const impacts: ImpactItem[] = [];

  // 1) 项目级硬阻断：已交付项目不得改期
  if (project.status === 'delivered') {
    impacts.push({
      category: 'project',
      severity: 'blocker',
      title: '项目已交付，交付日锁定',
      detail: `${project.code} 当前状态为 delivered，已交付项目不允许改期。如需变更请先走交付回退审批。`,
      refId: project.id,
    });
  }

  // 2) 日期倒退：不是阻断项，但必须显式勾选确认
  const requiresRegressionAck = direction === 'advance';
  if (requiresRegressionAck) {
    impacts.push({
      category: 'project',
      severity: 'warning',
      title: '交付日倒退',
      detail: `新交付日 ${newDate} 比当前交付日 ${oldDate} 提前 ${Math.abs(deltaDays)} 天，可能压缩制作与送审窗口，确认时需显式勾选知悉。`,
      refId: project.id,
    });
  }

  // 3) 合同里程碑：落在改期区间 / 晚于新交付日的未结清款项
  for (const contract of contracts.filter(c => c.projectId === projectId)) {
    for (const m of contract.milestones) {
      if (m.status === 'paid') continue;
      parseDependencyDate(m.due, `合同 ${contract.id} 里程碑「${m.name}」`);
      if (m.due > newDate) {
        impacts.push({
          category: 'contract',
          severity: 'critical',
          title: '里程碑晚于新交付日，交付后仍有偿付暴露',
          detail: `${contract.vendor}（${contract.id}）里程碑「${m.name}」${cny(m.amount)} 到期 ${m.due}，晚于新交付日 ${newDate}，需重排付款节点或确认尾款后置。`,
          refId: contract.id,
        });
      } else if (m.due >= oldDate && direction === 'postpone') {
        impacts.push({
          category: 'contract',
          severity: 'warning',
          title: '里程碑落入改期区间，需与供应商重排',
          detail: `${contract.vendor}（${contract.id}）里程碑「${m.name}」${cny(m.amount)} 到期 ${m.due}，落在 ${oldDate} → ${newDate} 区间内，原排期假设失效。`,
          refId: contract.id,
        });
      }
    }
  }

  // 4) 资产授权窗口：新交付日跨越授权到期 / 缓冲不足
  for (const asset of assets.filter(a => a.projectId === projectId)) {
    parseDependencyDate(asset.availableFrom, `资产 ${asset.id} 授权开始日`);
    parseDependencyDate(asset.availableTo, `资产 ${asset.id} 授权截止日`);
    if (asset.availableTo < newDate) {
      const crossesExpiry = asset.availableTo >= oldDate;
      impacts.push({
        category: 'asset',
        severity: crossesExpiry ? 'critical' : 'warning',
        title: crossesExpiry ? '新交付日跨越授权到期' : '授权窗口在旧交付日前已到期（存量缺口）',
        detail: `「${asset.name}」（${asset.id}，${asset.territories.join('、')} / ${asset.platforms.join('、')}）授权 ${asset.availableFrom} ~ ${asset.availableTo}，在新交付日 ${newDate} 前${crossesExpiry ? '到期，海外窗口不再覆盖交付，必须先续签或缩窗交付' : '即已失效'}。`,
        refId: asset.id,
      });
    } else {
      const bufferDays = Math.round(
        (new Date(`${asset.availableTo}T00:00:00Z`).getTime() - new Date(`${newDate}T00:00:00Z`).getTime()) / DAY_MS,
      );
      if (bufferDays < 30) {
        impacts.push({
          category: 'asset',
          severity: 'warning',
          title: '授权窗口对新交付日缓冲不足 30 天',
          detail: `「${asset.name}」（${asset.id}）授权截止 ${asset.availableTo}，仅覆盖新交付日后 ${bufferDays} 天，续签应在交付前启动。`,
          refId: asset.id,
        });
      }
    }
  }

  // 5) 在途审批：交付/资产/预算类受改期影响
  for (const approval of approvals.filter(r => r.projectId === projectId && r.status === 'pending')) {
    if (approval.entityType === 'delivery') {
      impacts.push({
        category: 'approval',
        severity: 'critical',
        title: '在途交付审批与新日期冲突',
        detail: `审批「${approval.title}」（${approval.id}，审批人 ${approval.approver}）仍在途，其引用的交付计划已变化，确认改期后需撤回或重新发起。`,
        refId: approval.id,
      });
    } else if (approval.entityType === 'asset') {
      impacts.push({
        category: 'approval',
        severity: 'warning',
        title: '在途资产审批需按新交付日复核',
        detail: `审批「${approval.title}」（${approval.id}）关联的资产锁定节奏随交付日后移，需确认授权窗口与新日期一致。`,
        refId: approval.id,
      });
    } else {
      impacts.push({
        category: 'approval',
        severity: 'info',
        title: '在途预算审批不受日期直接影响',
        detail: `审批「${approval.title}」（${approval.id}）保持在途，但改期可能带来延期成本，请知会审批人。`,
        refId: approval.id,
      });
    }
  }

  // 6) 预算风险：预测已超支 / 高风险科目在延期下可能继续走高
  const lines = budgetLines.filter(l => l.projectId === projectId);
  const overrun = lines.reduce((sum, l) => sum + Math.max(0, l.forecast - l.planned), 0);
  const highRisk = lines.filter(l => l.risk === 'high');
  if (overrun > 0 || highRisk.length > 0) {
    impacts.push({
      category: 'budget',
      severity: overrun > 0 ? 'warning' : 'info',
      title: direction === 'postpone' ? '后移交付可能放大预算敞口' : '预算预测已存在超支',
      detail: `当前预测超支合计 ${cny(overrun)}，高风险科目 ${highRisk.length} 项（${highRisk.map(l => l.subcategory).join('、') || '无'}）。${direction === 'postpone' ? `后移 ${deltaDays} 天可能产生额外人力、器材与授权续签费用。` : '日期提前不会消除既有超支。'}`,
      refId: project.budgetVersionId,
    });
  }

  return { impacts, direction, deltaDays, requiresRegressionAck };
}

function countBySeverity(impacts: ImpactItem[]): Record<ImpactSeverity, number> {
  return {
    blocker: impacts.filter(i => i.severity === 'blocker').length,
    critical: impacts.filter(i => i.severity === 'critical').length,
    warning: impacts.filter(i => i.severity === 'warning').length,
    info: impacts.filter(i => i.severity === 'info').length,
  };
}

function sweepExpired(nowMs: number) {
  for (const [token, record] of previews) {
    if (record.status !== 'open') continue;
    if (record.expiresAtMs <= nowMs) previews.delete(token);
  }
}

function toPreview(record: PreviewRecord): ReschedulePreview {
  const { expiresAtMs, fingerprint: _fingerprint, status: _status, ...rest } = record;
  return { ...rest, expiresAt: new Date(expiresAtMs).toISOString() };
}

export interface PreviewInput {
  projectId: string;
  newDate: string;
  reason?: string;
  requestedBy?: string;
}

/** 预览：只生成影响清单与票据，绝不修改任何业务数据。 */
export function previewReschedule(input: PreviewInput): ReschedulePreview {
  const reason = (input.reason ?? '').trim();
  if (!reason) throw new RescheduleError(400, '必须填写改期理由（海外窗口调整说明）', 'reason_required');
  if (reason.length > 500) throw new RescheduleError(400, '改期理由不能超过 500 字', 'reason_too_long');

  sweepExpired(Date.now());
  const evaluation = evaluate(input.projectId, input.newDate);
  const blockers = evaluation.impacts.filter(i => i.severity === 'blocker');
  const nowMs = Date.now();

  // 同一项目只允许一个有效预览：新预览使旧预览失效，确认旧票据即被识别为并发冲突
  for (const [token, record] of previews) {
    if (record.projectId === input.projectId && record.status === 'open') {
      // 保留记录本身，确认旧票据时才能返回明确的 superseded 冲突
      record.status = 'superseded';
    }
  }

  const record: PreviewRecord = {
    token: randomUUID(),
    projectId: input.projectId,
    oldDate: projects.find(p => p.id === input.projectId)!.deliveryDate,
    newDate: input.newDate,
    reason,
    requestedBy: (input.requestedBy ?? '').trim() || '当前用户',
    direction: evaluation.direction,
    deltaDays: evaluation.deltaDays,
    canConfirm: blockers.length === 0,
    requiresRegressionAck: evaluation.requiresRegressionAck,
    impacts: evaluation.impacts,
    impactCounts: countBySeverity(evaluation.impacts),
    expiresAtMs: nowMs + PREVIEW_TTL_MS,
    fingerprint: stateFingerprint(input.projectId),
    status: 'open',
  };
  previews.set(record.token, record);
  return toPreview(record);
}

export interface ConfirmInput {
  token: string;
  confirmRegression?: boolean;
  actor?: string;
}

export interface RescheduleSnapshot {
  oldDate: string;
  newDate: string;
  reason: string;
  requestedBy: string;
  direction: 'postpone' | 'advance';
  deltaDays: number;
  impactCounts: Record<ImpactSeverity, number>;
  impacts: ImpactItem[];
}

export interface ConfirmResult {
  applied: boolean;
  alreadyConfirmed: boolean;
  projectId: string;
  deliveryDate: string;
  auditId: string;
  confirmedAt: string;
  actor: string;
  snapshot: RescheduleSnapshot;
}

/** 确认：校验通过后一次性生效（改交付日 + 写审计），同一票据重复提交幂等。 */
export function confirmReschedule(input: ConfirmInput): ConfirmResult {
  const record = previews.get(input.token);
  if (!record) throw new RescheduleError(404, '预览票据不存在或已失效，请重新预览', 'preview_not_found');

  if (record.status === 'consumed') {
    // 重复提交：不重复改日期、不重复写审计，返回首次生效结果
    return {
      applied: false,
      alreadyConfirmed: true,
      projectId: record.projectId,
      deliveryDate: record.newDate,
      auditId: record.auditId!,
      confirmedAt: record.confirmedAt!,
      actor: input.actor?.trim() || record.requestedBy,
      snapshot: extractSnapshot(record),
    };
  }
  if (record.status === 'superseded') {
    throw new RescheduleError(409, '该预览已被更新的预览取代，存在并发改期，请基于最新清单重新确认', 'preview_superseded');
  }
  if (record.status === 'cancelled') {
    throw new RescheduleError(409, '该预览已取消，请重新预览', 'preview_cancelled');
  }
  if (record.expiresAtMs <= Date.now()) {
    previews.delete(input.token);
    throw new RescheduleError(410, '预览已过期（有效期 10 分钟），请重新预览', 'preview_expired');
  }

  const project = projects.find(p => p.id === record.projectId);
  if (!project) throw new RescheduleError(404, '项目不存在', 'project_not_found');

  // 乐观锁：预览之后合同、资产、审批或项目状态发生过变化则拒绝
  if (stateFingerprint(record.projectId) !== record.fingerprint) {
    throw new RescheduleError(409, '预览后合同里程碑、资产窗口、审批或项目状态已发生变化，请重新预览后再确认', 'state_changed');
  }
  if (record.impacts.some(i => i.severity === 'blocker')) {
    throw new RescheduleError(409, '存在阻断性影响（如项目已交付），不能确认生效', 'blocked');
  }
  if (record.requiresRegressionAck && !input.confirmRegression) {
    throw new RescheduleError(409, '日期倒退需要显式勾选知悉后才能确认', 'regression_ack_required');
  }

  // 一次性生效：下面两步在同一同步事务中完成，中途无 await
  const oldDate = project.deliveryDate;
  project.deliveryDate = record.newDate;
  const actor = (input.actor ?? '').trim() || record.requestedBy;
  const snapshot = extractSnapshot(record);
  const auditId = `AUD-RS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const confirmedAt = new Date().toISOString();
  auditEvents.unshift({
    id: auditId,
    action: 'RESCHEDULE_DELIVERY',
    entity: 'project',
    entityId: record.projectId,
    actor,
    at: confirmedAt,
    details: JSON.stringify(snapshot),
  });

  record.status = 'consumed';
  record.confirmedAt = confirmedAt;
  record.auditId = auditId;

  return {
    applied: true,
    alreadyConfirmed: false,
    projectId: record.projectId,
    deliveryDate: record.newDate,
    auditId,
    confirmedAt,
    actor,
    snapshot: { ...snapshot, oldDate },
  };
}

function extractSnapshot(record: PreviewRecord): RescheduleSnapshot {
  return {
    oldDate: record.oldDate,
    newDate: record.newDate,
    reason: record.reason,
    requestedBy: record.requestedBy,
    direction: record.direction,
    deltaDays: record.deltaDays,
    impactCounts: record.impactCounts,
    impacts: record.impacts,
  };
}

export function cancelReschedule(token: string): { cancelled: true } {
  const record = previews.get(token);
  if (!record) throw new RescheduleError(404, '预览票据不存在', 'preview_not_found');
  if (record.status === 'consumed') throw new RescheduleError(409, '预览已确认生效，无法取消', 'preview_consumed');
  record.status = 'cancelled';
  previews.delete(token);
  return { cancelled: true };
}

export interface RescheduleAuditEntry extends RescheduleSnapshot {
  id: string;
  actor: string;
  at: string;
}

export function projectRescheduleAudit(projectId: string): RescheduleAuditEntry[] {
  return auditEvents
    .filter(e => e.action === 'RESCHEDULE_DELIVERY' && e.entityId === projectId)
    .map(e => {
      try {
        return { id: e.id, actor: e.actor, at: e.at, ...(JSON.parse(e.details) as RescheduleSnapshot) };
      } catch {
        return undefined;
      }
    })
    .filter((e): e is RescheduleAuditEntry => Boolean(e));
}
