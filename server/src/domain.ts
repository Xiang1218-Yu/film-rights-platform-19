export type ProjectStatus = 'development' | 'production' | 'post' | 'delivered';
export type AssetType = 'master' | 'trailer' | 'poster' | 'audio' | 'subtitle';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export interface Project { id: string; code: string; title: string; season: number; status: ProjectStatus; currency: string; budgetVersionId: string; deliveryDate: string; }
export interface BudgetLine { id: string; projectId: string; category: string; subcategory: string; planned: number; committed: number; actual: number; forecast: number; owner: string; risk: 'low' | 'medium' | 'high'; }
export interface Contract { id: string; projectId: string; vendor: string; scope: string; ceiling: number; committed: number; paid: number; milestones: { name: string; due: string; amount: number; status: 'open' | 'invoiced' | 'paid' }[]; }
export interface Asset { id: string; projectId: string; name: string; type: AssetType; version: number; status: 'draft' | 'review' | 'approved' | 'locked'; owner: string; checksum: string; territories: string[]; platforms: string[]; availableFrom: string; availableTo: string; rightsTags: string[]; }
export interface Approval { id: string; projectId: string; entityType: 'budget' | 'asset' | 'delivery'; entityId: string; title: string; requestedBy: string; status: ApprovalStatus; approver: string; createdAt: string; comment?: string; }

/** 海外窗口调整带来的影响级别：critical 为阻断项，确认前必须显式接受。 */
export type RescheduleSeverity = 'critical' | 'warning' | 'info';

export interface MilestoneImpact { contractId: string; vendor: string; milestone: string; status: 'open' | 'invoiced' | 'paid'; oldDue: string; newDue: string | null; amount: number; note: string; severity: RescheduleSeverity }
export interface AssetWindowImpact { assetId: string; name: string; status: Asset['status']; oldAvailableTo: string; newAvailableTo: string | null; note: string; severity: RescheduleSeverity }
export interface ApprovalImpact { approvalId: string; title: string; oldStatus: ApprovalStatus; newStatus: ApprovalStatus | null; note: string; severity: RescheduleSeverity }
export interface BudgetImpact { lineId: string; subcategory: string; oldRisk: BudgetLine['risk']; newRisk: BudgetLine['risk'] | null; forecast: number; planned: number; note: string; severity: RescheduleSeverity }

/** 写入审计事件的影响快照，完整保留旧/新日期与每个受影响对象。 */
export interface DeliveryRescheduleSnapshot {
  projectId: string; projectCode: string; projectTitle: string;
  oldDate: string; newDate: string; reason: string; actor: string;
  deltaDays: number; allowBackward: boolean;
  milestoneImpacts: MilestoneImpact[];
  assetWindowImpacts: AssetWindowImpact[];
  approvalImpacts: ApprovalImpact[];
  budgetImpacts: BudgetImpact[];
  blockers: string[];
  previewId: string;
}

export interface RescheduleImpact {
  projectId: string;
  oldDate: string;
  newDate: string;
  reason: string;
  deltaDays: number;
  blocking: boolean;
  blockers: string[];
  milestoneImpacts: MilestoneImpact[];
  assetWindowImpacts: AssetWindowImpact[];
  approvalImpacts: ApprovalImpact[];
  budgetImpacts: BudgetImpact[];
  fingerprint: string;
}

export interface ReschedulePreview extends RescheduleImpact {
  previewId: string;
  projectCode: string;
  projectTitle: string;
  createdAt: string;
  allowBackward: boolean;
}

export interface RescheduleConfirmResult {
  auditId: string;
  projectId: string;
  oldDate: string;
  newDate: string;
  previewId: string;
  impact: RescheduleImpact;
  snapshot: DeliveryRescheduleSnapshot;
  appliedAt: string;
}

export class RescheduleError extends Error {
  constructor(public statusCode: number, message: string) { super(message); this.name = 'RescheduleError'; }
}

export interface AuditEvent { id: string; action: string; entity: string; entityId: string; actor: string; at: string; details: string; snapshot?: DeliveryRescheduleSnapshot; }

const now = Date.now();
const iso = (days: number) => new Date(now + days * 86400000).toISOString().slice(0, 10);

export const projects: Project[] = [
  { id: 'PRJ-001', code: 'NORTHSTAR-S1', title: 'Northstar / 北境回声', season: 1, status: 'post', currency: 'CNY', budgetVersionId: 'BUD-001-V3', deliveryDate: iso(44) },
  { id: 'PRJ-002', code: 'ORBIT-DOC', title: 'Orbit / 轨道之外', season: 1, status: 'production', currency: 'CNY', budgetVersionId: 'BUD-002-V2', deliveryDate: iso(126) }
];
export const budgetLines: BudgetLine[] = [
  { id: 'BL-101', projectId: 'PRJ-001', category: '制作', subcategory: '主演与主创', planned: 12800000, committed: 11200000, actual: 10400000, forecast: 13100000, owner: '制片部', risk: 'medium' },
  { id: 'BL-102', projectId: 'PRJ-001', category: '制作', subcategory: '摄影器材与场地', planned: 6800000, committed: 6400000, actual: 5980000, forecast: 7020000, owner: '现场制片', risk: 'low' },
  { id: 'BL-103', projectId: 'PRJ-001', category: '后期', subcategory: '调色、DIT、母版', planned: 5400000, committed: 4300000, actual: 2800000, forecast: 5750000, owner: '后期制片', risk: 'high' },
  { id: 'BL-104', projectId: 'PRJ-001', category: '宣发', subcategory: '预告片与物料', planned: 3600000, committed: 1900000, actual: 1240000, forecast: 3200000, owner: '营销部', risk: 'medium' },
  { id: 'BL-201', projectId: 'PRJ-002', category: '制作', subcategory: '跨国拍摄', planned: 9200000, committed: 5100000, actual: 3300000, forecast: 9000000, owner: '制片部', risk: 'medium' }
];
export const contracts: Contract[] = [
  { id: 'CTR-01', projectId: 'PRJ-001', vendor: '曜石后期制作', scope: '4K HDR 调色、声音、DCP 母版', ceiling: 5200000, committed: 4300000, paid: 2300000, milestones: [{ name: '锁剪交付', due: iso(8), amount: 1200000, status: 'invoiced' }, { name: '母版验收', due: iso(36), amount: 2000000, status: 'open' }] },
  { id: 'CTR-02', projectId: 'PRJ-001', vendor: '远景国际版权', scope: '北美与欧洲音乐同步许可', ceiling: 880000, committed: 880000, paid: 440000, milestones: [{ name: '签署', due: iso(-16), amount: 440000, status: 'paid' }, { name: '交付版权证明', due: iso(4), amount: 440000, status: 'invoiced' }] },
  { id: 'CTR-03', projectId: 'PRJ-002', vendor: '云帧视觉', scope: '纪录片航拍与卫星素材', ceiling: 1600000, committed: 1100000, paid: 600000, milestones: [{ name: '素材包一', due: iso(20), amount: 500000, status: 'open' }] }
];
export const assets: Asset[] = [
  { id: 'AST-001', projectId: 'PRJ-001', name: '北境回声 S01E01 4K HDR Master', type: 'master', version: 7, status: 'review', owner: '后期制片', checksum: 'sha256:91b7…e2a1', territories: ['CN', 'HK', 'SG'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-2), availableTo: iso(730), rightsTags: ['音乐-同步许可', '演员-全媒介'] },
  { id: 'AST-002', projectId: 'PRJ-001', name: '主预告 90s / Cut A', type: 'trailer', version: 4, status: 'approved', owner: '营销部', checksum: 'sha256:42ca…9b02', territories: ['CN'], platforms: ['StreamBox', '短视频'], availableFrom: iso(6), availableTo: iso(180), rightsTags: ['演员-宣传许可'] },
  { id: 'AST-003', projectId: 'PRJ-001', name: '片尾曲 / Winter Signal', type: 'audio', version: 2, status: 'locked', owner: '音乐版权', checksum: 'sha256:113c…78f0', territories: ['CN', 'US', 'CA'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-40), availableTo: iso(52), rightsTags: ['音乐-同步许可'] },
  { id: 'AST-004', projectId: 'PRJ-002', name: 'Orbit E02 Satellite Plates', type: 'master', version: 3, status: 'review', owner: '视觉总监', checksum: 'sha256:8a10…4a9d', territories: ['全球'], platforms: ['影院'], availableFrom: iso(18), availableTo: iso(365), rightsTags: ['航拍-编辑许可'] }
];
export const approvals: Approval[] = [
  { id: 'APR-01', projectId: 'PRJ-001', entityType: 'budget', entityId: 'BUD-001-V3', title: '后期超支预案 V3', requestedBy: '制片主任', status: 'pending', approver: '财务负责人', createdAt: iso(-1) },
  { id: 'APR-02', projectId: 'PRJ-001', entityType: 'asset', entityId: 'AST-001', title: 'E01 最终母版锁定', requestedBy: '后期制片', status: 'pending', approver: '总制片人', createdAt: iso(-2) },
  { id: 'APR-03', projectId: 'PRJ-002', entityType: 'delivery', entityId: 'DEL-007', title: '海外节展交付包', requestedBy: '发行部', status: 'approved', approver: '法务负责人', createdAt: iso(-5), comment: '已补充航拍授权凭证' }
];
export const auditEvents: AuditEvent[] = [{ id: 'AUD-01', action: 'CREATE', entity: 'budget', entityId: 'BUD-001-V3', actor: '制片主任', at: new Date(now - 86400000).toISOString(), details: '从 V2 复制并调整后期科目' }];

export function projectSummary(projectId = projects[0].id) {
  const lines = budgetLines.filter(line => line.projectId === projectId);
  const projectContracts = contracts.filter(contract => contract.projectId === projectId);
  const projectAssets = assets.filter(asset => asset.projectId === projectId);
  const projectApprovals = approvals.filter(approval => approval.projectId === projectId);
  const planned = lines.reduce((sum, line) => sum + line.planned, 0);
  const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
  const actual = lines.reduce((sum, line) => sum + line.actual, 0);
  return { project: projects.find(project => project.id === projectId), planned, forecast, actual, variance: forecast - planned, utilization: planned ? actual / planned : 0, committed: lines.reduce((sum, line) => sum + line.committed, 0), contractExposure: projectContracts.reduce((sum, contract) => sum + contract.ceiling, 0), assetCount: projectAssets.length, pendingApprovals: projectApprovals.filter(item => item.status === 'pending').length, highRiskLines: lines.filter(line => line.risk === 'high'), lines, contracts: projectContracts, assets: projectAssets, approvals: projectApprovals };
}

export function rightsConflicts(projectId = projects[0].id) {
  const list = assets.filter(asset => asset.projectId === projectId);
  const conflicts: { severity: 'critical' | 'warning'; assetA: string; assetB: string; reason: string }[] = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = list[i], b = list[j];
    const sameTag = a.rightsTags.some(tag => b.rightsTags.includes(tag));
    const sameTerritory = a.territories.includes('全球') || b.territories.includes('全球') || a.territories.some(territory => b.territories.includes(territory));
    if (sameTag && sameTerritory && a.availableTo >= b.availableFrom && b.availableTo >= a.availableFrom) conflicts.push({ severity: a.status === 'locked' || b.status === 'locked' ? 'critical' : 'warning', assetA: a.name, assetB: b.name, reason: `同一授权标签在重叠窗口内覆盖相同地域：${a.rightsTags.filter(tag => b.rightsTags.includes(tag)).join('、')}` });
  }
  return conflicts;
}

export function approve(id: string, status: ApprovalStatus, comment = '') {
  const item = approvals.find(approval => approval.id === id); if (!item) return undefined;
  item.status = status; item.comment = comment; auditEvents.unshift({ id: `AUD-${Date.now()}`, action: status.toUpperCase(), entity: item.entityType, entityId: item.entityId, actor: '当前审批人', at: new Date().toISOString(), details: comment || `${item.title} 已${status === 'approved' ? '通过' : '驳回'}` }); return item;
}
export function createApproval(input: Pick<Approval, 'projectId' | 'entityType' | 'entityId' | 'title' | 'requestedBy' | 'approver'>) { const item: Approval = { ...input, id: `APR-${Date.now()}`, status: 'pending', createdAt: new Date().toISOString() }; approvals.unshift(item); return item; }
export function dashboard() { return projects.map(project => projectSummary(project.id)).map(summary => ({ id: summary.project?.id, title: summary.project?.title, status: summary.project?.status, deliveryDate: summary.project?.deliveryDate, forecast: summary.forecast, variance: summary.variance, pendingApprovals: summary.pendingApprovals, rightsConflicts: rightsConflicts(summary.project?.id).length })); }

// ───────────────────────── 交付日“预览—确认”流程 ─────────────────────────
// 规则：交付日后移不是摘要字段的直接修改，而是一次需要先看清影响（合同里程碑、
// 授权窗口、审批、预算风险）、再一次性生效并写入审计快照的受控变更。

const DAY_MS = 86400000;
/** 种子数据快照：模块加载后立即冻结，供测试/演练钩子把内存仓储恢复初始状态。 */
const seedProjects = structuredClone(projects);
const seedBudgetLines = structuredClone(budgetLines);
const seedContracts = structuredClone(contracts);
const seedAssets = structuredClone(assets);
const seedApprovals = structuredClone(approvals);
const seedAuditEvents = structuredClone(auditEvents);

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RescheduleError(400, `日期格式非法：${value}，需要 YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new RescheduleError(400, `日期无法解析：${value}`);
  return date;
}
function dayDiff(from: string, to: string) { return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS); }
function addDays(value: string, days: number) { return new Date(parseDate(value).getTime() + days * DAY_MS).toISOString().slice(0, 10); }

/** 稳定序列化：影响清单以同样顺序重算时指纹必须一致，用于并发确认检测。 */
function stableFingerprint(payload: unknown) {
  const ordered = JSON.stringify(payload, Object.keys(payload as Record<string, unknown>).sort());
  let hash = 0;
  for (let i = 0; i < ordered.length; i += 1) { hash = (hash * 31 + ordered.charCodeAt(i)) | 0; }
  return `fp-${(hash >>> 0).toString(16)}-${ordered.length}`;
}

interface PreviewRecord extends ReschedulePreview { consumed: boolean; }
const previewStore = new Map<string, PreviewRecord>();
const idempotencyStore = new Map<string, { key: string; projectId: string; result: RescheduleConfirmResult }>();
let rescheduleSeq = 1;

/** 依赖计算故障演练开关：置位后下一次影响计算将失败且不产生任何变更。 */
let failNextDependencyCalculation = false;
export function setDependencyCalculationFailure(enabled: boolean) { failNextDependencyCalculation = enabled; }

/** 供 HTTP 层识别幂等回放（重复提交时返回首次结果并在响应头标注）。 */
export function hasIdempotencyRecord(key: string) { return idempotencyStore.has(key); }

export function resetDemoState() {
  projects.splice(0, projects.length, ...structuredClone(seedProjects));
  budgetLines.splice(0, budgetLines.length, ...structuredClone(seedBudgetLines));
  contracts.splice(0, contracts.length, ...structuredClone(seedContracts));
  assets.splice(0, assets.length, ...structuredClone(seedAssets));
  approvals.splice(0, approvals.length, ...structuredClone(seedApprovals));
  auditEvents.splice(0, auditEvents.length, ...structuredClone(seedAuditEvents));
  previewStore.clear();
  idempotencyStore.clear();
  failNextDependencyCalculation = false;
}

function validateRequest(projectId: string, newDate: string, reason: string): Project {
  const project = projects.find(item => item.id === projectId);
  if (!project) throw new RescheduleError(404, '项目不存在');
  parseDate(newDate);
  if (!reason || !reason.trim()) throw new RescheduleError(400, '必须填写海外窗口调整理由');
  if (project.status === 'delivered') throw new RescheduleError(422, `项目 ${project.code} 已交付，不能再调整交付日`);
  return project;
}

/** 依赖计算：汇总各领域对象在新交付日下的变化。失败时必须整体中止，不留半成品。 */
function computeImpact(projectId: string, newDate: string, reason: string, allowBackward: boolean): RescheduleImpact {
  if (failNextDependencyCalculation) {
    failNextDependencyCalculation = false;
    throw new RescheduleError(503, '依赖计算失败：合同/授权窗口依赖暂时不可用，请稍后重试；本次未产生任何变更');
  }
  const project = validateRequest(projectId, newDate, reason);
  const oldDate = project.deliveryDate;
  const deltaDays = dayDiff(oldDate, newDate);
  const blockers: string[] = [];
  if (deltaDays === 0) throw new RescheduleError(400, '新交付日与当前交付日相同，无需调整');
  if (deltaDays < 0 && !allowBackward) blockers.push(`日期倒退：${oldDate} → ${newDate}（提前 ${-deltaDays} 天），需显式确认“允许倒退”后重新预览`);

  // 1) 合同里程碑：后移时把落在旧交付日之前的未完成里程碑顺延（已开票标记警示，已付款保留并提示）。
  const milestoneImpacts: MilestoneImpact[] = [];
  if (deltaDays > 0) {
    contracts.filter(contract => contract.projectId === projectId).forEach(contract => {
      contract.milestones.forEach(milestone => {
        if (milestone.status === 'paid' || milestone.due > oldDate) return;
        const newDue = addDays(milestone.due, deltaDays);
        if (milestone.status === 'open') {
          milestoneImpacts.push({ contractId: contract.id, vendor: contract.vendor, milestone: milestone.name, status: milestone.status, oldDue: milestone.due, newDue, amount: milestone.amount, note: `未支付里程碑随交付日后移 ${deltaDays} 天`, severity: 'info' });
        } else {
          milestoneImpacts.push({ contractId: contract.id, vendor: contract.vendor, milestone: milestone.name, status: milestone.status, oldDue: milestone.due, newDue, amount: milestone.amount, note: '里程碑已开票，顺延付款节点前必须与供应商确认账期', severity: 'warning' });
        }
      });
    });
  }

  // 2) 资产授权窗口：区分“旧交付日前就失效”“后移后跨过授权到期”“随窗口顺延”。
  const assetWindowImpacts: AssetWindowImpact[] = [];
  for (const asset of assets.filter(item => item.projectId === projectId)) {
    if (deltaDays < 0) {
      if (asset.availableFrom > newDate) assetWindowImpacts.push({ assetId: asset.id, name: asset.name, status: asset.status, oldAvailableTo: asset.availableTo, newAvailableTo: null, note: `授权窗口 ${asset.availableFrom} 才开始，早于新交付日 ${newDate}，素材在交付节点不可用`, severity: 'critical' });
      continue;
    }
    if (asset.availableTo < oldDate) {
      assetWindowImpacts.push({ assetId: asset.id, name: asset.name, status: asset.status, oldAvailableTo: asset.availableTo, newAvailableTo: null, note: `授权在当前交付日前（${asset.availableTo}）已到期，延期无法自动续期，必须先完成版权续签`, severity: 'critical' });
    } else if (asset.availableTo < newDate) {
      const newAvailableTo = addDays(asset.availableTo, deltaDays);
      assetWindowImpacts.push({ assetId: asset.id, name: asset.name, status: asset.status, oldAvailableTo: asset.availableTo, newAvailableTo, note: `新交付日跨过授权到期（${asset.availableTo}），确认后授权窗口同步顺延 ${deltaDays} 天；${asset.status === 'locked' ? '该资产已锁定，需法务复核' : '需版权方出具延期函'}`, severity: 'critical' });
    } else {
      const newAvailableTo = addDays(asset.availableTo, deltaDays);
      assetWindowImpacts.push({ assetId: asset.id, name: asset.name, status: asset.status, oldAvailableTo: asset.availableTo, newAvailableTo, note: `授权覆盖新交付日，窗口随之后移 ${deltaDays} 天`, severity: asset.status === 'locked' ? 'warning' : 'info' });
    }
  }

  // 3) 审批：挂起的交付审批因交付日变化自动失效；挂起的资产审批需要重新评估。
  const approvalImpacts: ApprovalImpact[] = [];
  for (const approval of approvals.filter(item => item.projectId === projectId && item.status === 'pending')) {
    if (approval.entityType === 'delivery') {
      approvalImpacts.push({ approvalId: approval.id, title: approval.title, oldStatus: 'pending', newStatus: 'superseded', note: `交付审批基于旧交付日 ${oldDate}，确认后自动标记为已失效，需要重新提交`, severity: 'critical' });
    } else if (approval.entityType === 'asset') {
      approvalImpacts.push({ approvalId: approval.id, title: approval.title, oldStatus: 'pending', newStatus: null, note: '资产审批保留在挂起队列，但授权窗口将变化，确认后请审批人重新复核', severity: 'warning' });
    }
  }

  // 4) 预算：后移会拉长制作/后期周期，已超预测的中风险科目升级为高风险。
  const budgetImpacts: BudgetImpact[] = [];
  if (deltaDays > 0) {
    for (const line of budgetLines.filter(item => item.projectId === projectId)) {
      if (line.risk === 'medium' && line.forecast > line.planned) {
        budgetImpacts.push({ lineId: line.id, subcategory: line.subcategory, oldRisk: 'medium', newRisk: 'high', forecast: line.forecast, planned: line.planned, note: `交付后移 ${deltaDays} 天带来追加人力/场地与供应商账期成本，预测已超预算 ${Math.round((line.forecast / line.planned - 1) * 100)}%，风险等级 medium → high`, severity: 'warning' });
      }
    }
  }

  const allImpacts = [...milestoneImpacts, ...assetWindowImpacts, ...approvalImpacts, ...budgetImpacts];
  allImpacts.filter(item => item.severity === 'critical').forEach(item => blockers.push(item.note));

  const fingerprintBase = {
    projectId, oldDate, newDate, reason: reason.trim(), deltaDays,
    milestoneImpacts: milestoneImpacts.map(item => [item.contractId, item.milestone, item.oldDue, item.newDue, item.severity]),
    assetWindowImpacts: assetWindowImpacts.map(item => [item.assetId, item.oldAvailableTo, item.newAvailableTo, item.severity]),
    approvalImpacts: approvalImpacts.map(item => [item.approvalId, item.oldStatus, item.newStatus, item.severity]),
    budgetImpacts: budgetImpacts.map(item => [item.lineId, item.oldRisk, item.newRisk, item.severity]),
  };
  return {
    projectId, oldDate, newDate, reason: reason.trim(), deltaDays,
    blocking: blockers.length > 0, blockers,
    milestoneImpacts, assetWindowImpacts, approvalImpacts, budgetImpacts,
    fingerprint: stableFingerprint(fingerprintBase),
  };
}

/** 第一步：仅生成影响清单，绝不修改任何日期或业务数据。 */
export function previewDeliveryReschedule(input: { projectId: string; newDate: string; reason: string; allowBackward?: boolean; actor?: string }): ReschedulePreview {
  const project = validateRequest(input.projectId, input.newDate, input.reason);
  const impact = computeImpact(input.projectId, input.newDate, input.reason, input.allowBackward === true);
  const previewId = `RSH-P${String(rescheduleSeq += 1).padStart(4, '0')}`;
  const record: PreviewRecord = {
    ...impact, previewId, projectCode: project.code, projectTitle: project.title,
    createdAt: new Date().toISOString(), allowBackward: input.allowBackward === true, consumed: false,
  };
  previewStore.set(previewId, record);
  const { consumed: _consumed, ...preview } = record;
  return preview;
}

/** 第二步：基于一次性预览令牌一次性生效；处理并发确认、重复提交与阻断项。 */
export function confirmDeliveryReschedule(input: { previewId: string; idempotencyKey?: string; actor?: string }): RescheduleConfirmResult {
  // 重复提交：相同幂等键直接回放首次结果，不重复改数据、不重复写审计。
  if (input.idempotencyKey) {
    const existing = idempotencyStore.get(input.idempotencyKey);
    if (existing) return existing.result;
  }
  const record = previewStore.get(input.previewId);
  if (!record) throw new RescheduleError(404, '预览不存在或已过期，请重新生成影响清单');
  if (record.consumed) throw new RescheduleError(409, `预览 ${input.previewId} 已被确认，请重新预览后再操作`);

  const project = projects.find(item => item.id === record.projectId);
  if (!project) throw new RescheduleError(404, '项目不存在');

  // 并发确认 1：预览生成后，项目交付日已经被其他操作改动。
  if (project.deliveryDate !== record.oldDate) {
    throw new RescheduleError(409, `交付日已被并发操作修改（当前 ${project.deliveryDate}，预览基线 ${record.oldDate}），请刷新后重新预览`);
  }
  if (project.status === 'delivered') throw new RescheduleError(422, '项目在预览后已标记为交付，本次调整已中止');

  // 并发确认 2：重算影响清单，合同/授权/审批/预算在预览后被改过会造成指纹不一致。
  const fresh = computeImpact(record.projectId, record.newDate, record.reason, record.allowBackward);
  if (fresh.fingerprint !== record.fingerprint) {
    throw new RescheduleError(409, '影响清单与预览时不一致：合同、授权窗口、审批或预算已发生并发变化，请刷新后重新预览');
  }
  if (fresh.blocking) throw new RescheduleError(422, `仍存在 ${fresh.blockers.length} 项阻断影响，不能确认：${fresh.blockers.join('；')}`);

  // ── 一次性生效：项目日期、里程碑、授权窗口、审批状态、预算风险同事务式提交 ──
  const actor = input.actor || '当前制片协调人';
  project.deliveryDate = record.newDate;

  contracts.forEach(contract => {
    if (contract.projectId !== project.id) return;
    contract.milestones.forEach(milestone => {
      const target = record.milestoneImpacts.find(item => item.contractId === contract.id && item.milestone === milestone.name && item.oldDue === milestone.due);
      if (target?.newDue) milestone.due = target.newDue;
    });
  });
  assets.forEach(asset => {
    if (asset.projectId !== project.id) return;
    const target = record.assetWindowImpacts.find(item => item.assetId === asset.id);
    if (target?.newAvailableTo) asset.availableTo = target.newAvailableTo;
  });
  approvals.forEach(approval => {
    const target = record.approvalImpacts.find(item => item.approvalId === approval.id);
    if (target?.newStatus === 'superseded') {
      approval.status = 'superseded';
      approval.comment = `交付日 ${record.oldDate} → ${record.newDate}，原审批自动失效（${record.reason}）`;
    }
  });
  budgetLines.forEach(line => {
    const target = record.budgetImpacts.find(item => item.lineId === line.id);
    if (target?.newRisk) line.risk = target.newRisk;
  });

  const snapshot: DeliveryRescheduleSnapshot = {
    projectId: project.id, projectCode: project.code, projectTitle: project.title,
    oldDate: record.oldDate, newDate: record.newDate, reason: record.reason, actor,
    deltaDays: record.deltaDays, allowBackward: record.allowBackward,
    milestoneImpacts: record.milestoneImpacts, assetWindowImpacts: record.assetWindowImpacts,
    approvalImpacts: record.approvalImpacts, budgetImpacts: record.budgetImpacts,
    blockers: record.blockers, previewId: record.previewId,
  };
  const auditId = `AUD-${Date.now()}-${rescheduleSeq += 1}`;
  auditEvents.unshift({
    id: auditId, action: 'RESCHEDULE_DELIVERY', entity: 'project', entityId: project.id, actor,
    at: new Date().toISOString(),
    details: `交付日 ${record.oldDate} → ${record.newDate}（${record.deltaDays > 0 ? '后移' : '提前'} ${Math.abs(record.deltaDays)} 天）；理由：${record.reason}；影响 ${record.milestoneImpacts.length} 个里程碑 / ${record.assetWindowImpacts.length} 个授权窗口 / ${record.approvalImpacts.length} 个审批 / ${record.budgetImpacts.length} 个预算科目`,
    snapshot,
  });

  record.consumed = true;
  const result: RescheduleConfirmResult = { auditId, projectId: project.id, oldDate: record.oldDate, newDate: record.newDate, previewId: record.previewId, impact: fresh, snapshot, appliedAt: new Date().toISOString() };
  if (input.idempotencyKey) idempotencyStore.set(input.idempotencyKey, { key: input.idempotencyKey, projectId: project.id, result });
  return result;
}

export function deliveryRescheduleAudit(projectId: string) {
  return auditEvents.filter(event => event.action === 'RESCHEDULE_DELIVERY' && event.entityId === projectId);
}
