import { useCallback, useEffect, useMemo, useState } from 'react';

type Project = { id: string; code: string; title: string; status: string; deliveryDate: string };
type Milestone = { name: string; due: string; status: string };
type Contract = { id: string; vendor: string; scope: string; committed: number; paid: number; milestones: Milestone[] };
type Asset = { id: string; name: string; type: string; version: number; status: string; availableTo: string };
type Approval = { id: string; title: string; status: string; approver: string };
type Summary = {
  planned: number; forecast: number; actual: number; variance: number; utilization: number;
  committed: number; contractExposure: number; assetCount: number; pendingApprovals: number;
  highRiskLines: { subcategory: string; forecast: number; planned: number }[];
  lines: { id: string; category: string; subcategory: string; planned: number; committed: number; forecast: number; actual: number; risk: string }[];
  contracts: Contract[]; assets: Asset[]; approvals: Approval[]; project: Project;
};
type Conflict = { severity: string; assetA: string; assetB: string; reason: string };

type Severity = 'critical' | 'warning' | 'info';
type ReschedulePreview = {
  previewId: string; projectCode: string; projectTitle: string;
  oldDate: string; newDate: string; reason: string; deltaDays: number;
  blocking: boolean; blockers: string[];
  milestoneImpacts: { contractId: string; vendor: string; milestone: string; status: string; oldDue: string; newDue: string | null; amount: number; note: string; severity: Severity }[];
  assetWindowImpacts: { assetId: string; name: string; status: string; oldAvailableTo: string; newAvailableTo: string | null; note: string; severity: Severity }[];
  approvalImpacts: { approvalId: string; title: string; oldStatus: string; newStatus: string | null; note: string; severity: Severity }[];
  budgetImpacts: { lineId: string; subcategory: string; oldRisk: string; newRisk: string | null; note: string; severity: Severity }[];
};
type RescheduleSnapshot = {
  oldDate: string; newDate: string; reason: string; actor: string; deltaDays: number; allowBackward: boolean;
  milestoneImpacts: unknown[]; assetWindowImpacts: unknown[]; approvalImpacts: unknown[]; budgetImpacts: unknown[];
};
type RescheduleAudit = { id: string; actor: string; at: string; details: string; snapshot: RescheduleSnapshot };

const money = (n: number) => `¥${(n / 10000).toFixed(0)}万`;
const api = '/api';
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `请求失败 (${response.status})`);
  return body as T;
}
const severityLabel = (severity: Severity) => (severity === 'critical' ? 'CRITICAL' : severity === 'warning' ? 'WARNING' : 'INFO');

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('PRJ-001');
  const [summary, setSummary] = useState<Summary>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [tab, setTab] = useState<'overview' | 'budget' | 'rights'>('overview');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const load = useCallback(async (id = 'PRJ-001') => {
    setLoading(true); setError('');
    try {
      const items = await request<Project[]>('/projects');
      const active = items.find(item => item.id === id) ?? items[0];
      if (!active) throw new Error('服务端没有返回项目数据');
      const [s, c] = await Promise.all([
        request<Summary>(`/projects/${active.id}/summary`),
        request<Conflict[]>(`/projects/${active.id}/rights-conflicts`),
      ]);
      setProjects(items); setSelected(active.id); setSummary(s); setConflicts(c);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接制作服务');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const approve = async (id: string) => {
    try {
      await request(`/approvals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved', comment: '在控制台完成复核' }) });
      setMessage('审批已通过，审计事件已写入');
      await load(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '审批操作失败'); }
  };

  const variancePct = useMemo(() => summary ? Math.round(summary.variance / summary.planned * 100) : 0, [summary]);

  if (loading && !summary) return <main className="connection-state"><div className="loading">正在载入制作控制台…</div><small>正在通过 Vite API 代理连接本地制作服务</small></main>;
  if (!summary) return <main className="connection-state"><h2>无法连接制作服务</h2><p>{error || '服务端没有返回项目数据。'}</p><p>请从项目根目录运行 <code>npm run dev</code>，确认前端 5173 和 API 4104 均已启动。</p><button onClick={() => void load(selected)}>重新连接</button></main>;

  return <main>
    <header>
      <div>
        <div className="eyebrow">STUDIO OPS / RIGHTS & FINANCE CONTROL</div>
        <h1>FrameLedger <span>影视制作预算与资产版权协同</span></h1>
        <p>将预算承诺、供应商付款、资产版本与跨地域版权窗口串成可审计的交付链路。</p>
      </div>
      <div className="header-actions">
        <select value={selected} onChange={e => { setSelected(e.target.value); void load(e.target.value); }}>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
        <span className="live"><i /> LIVE CONTROL</span>
      </div>
    </header>
    {message && <div className="toast" onClick={() => setMessage('')}>{message} ×</div>}
    {error && <div className="toast error-toast" onClick={() => setError('')}>{error} ×</div>}

    <section className="kpis">
      <div><small>FORECAST COST</small><b>{money(summary.forecast)}</b><span>预算偏差 <em className={summary.variance > 0 ? 'bad' : ''}>{variancePct}%</em></span></div>
      <div><small>COMMITTED</small><b>{money(summary.committed)}</b><span>已锁定供应商与合同</span></div>
      <div><small>ASSET REGISTER</small><b>{summary.assetCount}<em> 个</em></b><span>版本与交付状态纳管</span></div>
      <div><small>RISK QUEUE</small><b>{summary.pendingApprovals + conflicts.length}<em> 项</em></b><span>{conflicts.length} 条版权冲突 / {summary.pendingApprovals} 个审批</span></div>
    </section>

    <nav className="tabs">
      <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>项目驾驶舱</button>
      <button className={tab === 'budget' ? 'active' : ''} onClick={() => setTab('budget')}>预算与合同</button>
      <button className={tab === 'rights' ? 'active' : ''} onClick={() => setTab('rights')}>资产版权图谱</button>
      {/* 交付日是所有页面共享的唯一数据源，调整必须走“预览—确认”流程 */}
      <span className="delivery-date">交付日 <b>{summary.project.deliveryDate}</b><button className="link-btn" onClick={() => setRescheduleOpen(true)}>海外窗口调整</button></span>
    </nav>

    {tab === 'overview' && <div className="grid">
      <section className="panel hero">
        <div className="panel-head">
          <div><div className="eyebrow">PROJECT HEALTH / {summary.project.id}</div><h2>{summary.project.title}</h2></div>
          <span className="badge amber">{summary.project.status.toUpperCase()}</span>
        </div>
        <div className="progress-label"><span>成本消耗 {Math.round(summary.utilization * 100)}%</span><b>{money(summary.actual)} / {money(summary.planned)}</b></div>
        <div className="progress"><i style={{ width: `${Math.min(100, summary.utilization * 100)}%` }} /></div>
        <div className="split">
          <div><small>合同暴露额</small><strong>{money(summary.contractExposure)}</strong></div>
          <div><small>高风险预算项</small><strong className="bad">{summary.highRiskLines.length}</strong></div>
          <div><small>版权冲突</small><strong className={conflicts.length ? 'bad' : ''}>{conflicts.length}</strong></div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>待审批队列</h3><span>{summary.approvals.filter(a => a.status === 'pending').length} PENDING</span></div>
        {summary.approvals.map(a => <div className="approval" key={a.id}>
          <span className={`status ${a.status}`} />
          <div><b>{a.title}</b><small>{a.approver} · {a.id}{a.status === 'superseded' ? ' · 交付日已变更，审批失效' : ''}</small></div>
          {a.status === 'pending' ? <button onClick={() => approve(a.id)}>通过</button> : <em>已完成</em>}
        </div>)}
      </section>
      <section className="panel wide">
        <div className="panel-head"><h3>交付风险雷达</h3><span>基于版本、授权窗口与预算预测</span></div>
        {conflicts.length ? conflicts.map((c, i) => <div className="risk-row" key={i}>
          <strong className={c.severity}>{c.severity === 'critical' ? 'CRITICAL' : 'WARNING'}</strong>
          <div><b>{c.assetA}</b><small>↔ {c.assetB} · {c.reason}</small></div>
        </div>) : <div className="empty">当前项目未发现版权窗口冲突。</div>}
      </section>
    </div>}

    {tab === 'budget' && <div className="grid">
      <section className="panel wide">
        <div className="panel-head"><h3>预算版本 V3 / 成本基线</h3><span>实际 + 承诺 + 预测</span></div>
        <div className="table">
          <div className="tr th"><span>科目</span><span>预算</span><span>已承诺</span><span>实际</span><span>预测</span><span>风险</span></div>
          {summary.lines.map(line => <div className="tr" key={line.id}>
            <span><b>{line.category}</b><small>{line.subcategory}</small></span>
            <span>{money(line.planned)}</span><span>{money(line.committed)}</span><span>{money(line.actual)}</span>
            <span className={line.forecast > line.planned ? 'bad' : ''}>{money(line.forecast)}</span>
            <span className={`risk ${line.risk}`}>{line.risk}</span>
          </div>)}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>供应商付款里程碑</h3></div>
        {summary.contracts.map(c => <div className="contract" key={c.id ?? c.vendor}>
          <b>{c.vendor}</b><small>{c.scope}</small>
          <div className="contract-bar"><i style={{ width: `${Math.round(c.paid / c.committed * 100)}%` }} /></div>
          <span>{money(c.paid)} / {money(c.committed)}</span><em>{c.milestones.filter(m => m.status !== 'paid').length} 个待结点 · 下一节点 {c.milestones.filter(m => m.status !== 'paid')[0]?.due ?? '—'}</em>
        </div>)}
      </section>
    </div>}

    {tab === 'rights' && <div className="grid">
      <section className="panel wide">
        <div className="panel-head"><h3>资产版本登记</h3><span>{summary.assets.length} assets / checksum tracked · 授权截止随交付日联动</span></div>
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: '1.6fr repeat(3,1fr)' }}><span>资产</span><span>版本</span><span>状态</span><span>授权截止</span></div>
          {summary.assets.map(a => <div className="tr" key={a.id} style={{ gridTemplateColumns: '1.6fr repeat(3,1fr)' }}>
            <span><b>{a.name}</b><small>{a.id} · {a.type}</small></span><span>v{a.version}</span>
            <span className={`pill ${a.status}`}>{a.status}</span><span>{a.availableTo}</span>
          </div>)}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>授权冲突</h3><span>{conflicts.length} detected</span></div>
        {conflicts.map((c, i) => <div className="conflict" key={i}><strong>{c.severity}</strong><b>{c.assetA}</b><small>{c.reason}</small></div>)}
      </section>
    </div>}

    {rescheduleOpen && <RescheduleDialog
      project={summary.project}
      onClose={() => setRescheduleOpen(false)}
      onConfirmed={async msg => { setRescheduleOpen(false); setMessage(msg); await load(selected); }}
      onError={setError}
    />}

    <footer>FrameLedger baseline · 内存仓储 + REST API · 交付日调整采用“预览—确认”两阶段，含并发/幂等控制与审计快照</footer>
  </main>;
}

function ImpactGroup({ title, rows }: { title: string; rows: { key: string; head: string; old: string; next: string | null; note: string; severity: Severity }[] }) {
  if (!rows.length) return null;
  return <div className="impact-group">
    <h4>{title} <span>{rows.length}</span></h4>
    {rows.map(row => <div className={`impact-row ${row.severity}`} key={row.key}>
      <strong>{severityLabel(row.severity)}</strong>
      <div><b>{row.head}</b><small>{row.old}{row.next ? ` → ${row.next}` : ''} · {row.note}</small></div>
    </div>)}
  </div>;
}

function RescheduleDialog({ project, onClose, onConfirmed, onError }: {
  project: Project;
  onClose: () => void;
  onConfirmed: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [newDate, setNewDate] = useState(project.deliveryDate);
  const [reason, setReason] = useState('');
  const [allowBackward, setAllowBackward] = useState(false);
  const [preview, setPreview] = useState<ReschedulePreview>();
  const [busy, setBusy] = useState<'' | 'preview' | 'confirm'>('');
  const [localError, setLocalError] = useState('');
  const [history, setHistory] = useState<RescheduleAudit[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  useEffect(() => {
    request<RescheduleAudit[]>(`/projects/${project.id}/delivery-audit`).then(setHistory).catch(() => setHistory([]));
  }, [project.id]);

  const runPreview = async () => {
    setBusy('preview'); setLocalError(''); setPreview(undefined);
    try {
      const result = await request<ReschedulePreview>(`/projects/${project.id}/delivery-reschedule/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newDate, reason, allowBackward }),
      });
      setPreview(result);
    } catch (reasonItem) { setLocalError(reasonItem instanceof Error ? reasonItem.message : '预览失败'); }
    finally { setBusy(''); }
  };

  const runConfirm = async () => {
    if (!preview) return;
    setBusy('confirm'); setLocalError('');
    // 幂等键随“这一次确认意图”生成；网络重试/重复点击都回放同一结果
    const key = idempotencyKey || `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setIdempotencyKey(key);
    try {
      await request(`/delivery-reschedule/${preview.previewId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({}),
      });
      onConfirmed(`交付日已一次性生效：${preview.oldDate} → ${preview.newDate}，影响清单已写入审计快照`);
    } catch (reasonItem) {
      const message = reasonItem instanceof Error ? reasonItem.message : '确认失败';
      // 并发变化 / 依赖故障都必须重新预览，清掉过期清单
      if (message.includes('并发') || message.includes('不一致') || message.includes('依赖')) {
        setPreview(undefined); setIdempotencyKey('');
      }
      setLocalError(message);
      onError(message);
    } finally { setBusy(''); }
  };

  const deltaText = preview ? `${preview.deltaDays > 0 ? '后移' : '提前'} ${Math.abs(preview.deltaDays)} 天` : '';

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <div className="modal-head">
        <div><div className="eyebrow">DELIVERY RESCHEDULE / {project.code}</div><h3>海外窗口调整 · {project.title}</h3></div>
        <button className="link-btn" onClick={onClose}>关闭 ×</button>
      </div>

      {!preview && <div className="modal-body">
        <p className="modal-hint">交付日不是可直接编辑的摘要字段。先预览合同节点、授权窗口、审批与预算风险，确认后一次性生效。</p>
        <label className="field"><span>当前交付日</span><b>{project.deliveryDate}</b></label>
        <label className="field"><span>新交付日</span><input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} /></label>
        <label className="field"><span>调整理由（必填，进入审计）</span><textarea rows={2} value={reason} placeholder="例如：海外平台 StreamBox 排播窗口后移，要求母版交付延后" onChange={e => setReason(e.target.value)} /></label>
        <label className="field checkbox"><input type="checkbox" checked={allowBackward} onChange={e => setAllowBackward(e.target.checked)} /><span>我知道这是日期<em>倒退</em>（提前交付），接受排期与授权风险，允许按该日期重新预览</span></label>
        {localError && <div className="modal-error">{localError}</div>}
        <div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" disabled={busy === 'preview'} onClick={() => void runPreview()}>{busy === 'preview' ? '正在计算依赖…' : '生成影响清单（预览）'}</button></div>
      </div>}

      {preview && <div className="modal-body">
        <div className={`preview-banner ${preview.blocking ? 'blocked' : 'clear'}`}>
          <b>{preview.blocking ? '存在阻断影响，不能确认' : '影响清单可确认'}</b>
          <span>{preview.oldDate} → {preview.newDate}（{deltaText}）· 理由：{preview.reason}</span>
        </div>
        {preview.blockers.length > 0 && <ul className="blockers">{preview.blockers.map((blocker, i) => <li key={i}>{blocker}</li>)}</ul>}
        <ImpactGroup title="合同付款节点" rows={preview.milestoneImpacts.map(item => ({ key: `${item.contractId}-${item.milestone}`, head: `${item.vendor} · ${item.milestone}（${item.status}，${money(item.amount)}）`, old: item.oldDue, next: item.newDue, note: item.note, severity: item.severity }))} />
        <ImpactGroup title="资产授权窗口" rows={preview.assetWindowImpacts.map(item => ({ key: item.assetId, head: `${item.name}（${item.status}）`, old: item.oldAvailableTo, next: item.newAvailableTo, note: item.note, severity: item.severity }))} />
        <ImpactGroup title="审批队列" rows={preview.approvalImpacts.map(item => ({ key: item.approvalId, head: item.title, old: item.oldStatus, next: item.newStatus, note: item.note, severity: item.severity }))} />
        <ImpactGroup title="预算风险" rows={preview.budgetImpacts.map(item => ({ key: item.lineId, head: item.subcategory, old: item.oldRisk, next: item.newRisk, note: item.note, severity: item.severity }))} />
        {![...preview.milestoneImpacts, ...preview.assetWindowImpacts, ...preview.approvalImpacts, ...preview.budgetImpacts].length && <div className="empty">该日期变化不影响任何合同、授权、审批或预算科目。</div>}
        {localError && <div className="modal-error">{localError}</div>}
        <div className="modal-actions">
          <button onClick={() => { setPreview(undefined); setIdempotencyKey(''); }}>返回修改</button>
          <button className="primary danger" disabled={busy === 'confirm' || preview.blocking} onClick={() => void runConfirm()} title={preview.blocking ? '请先解除阻断影响（如续签授权）后重新预览' : ''}>
            {busy === 'confirm' ? '正在一次性生效…' : preview.blocking ? '存在阻断项，禁止确认' : '确认并一次性生效'}
          </button>
        </div>
        <small className="preview-meta">预览令牌 {preview.previewId} · 仅可确认一次；并发改动会在确认时被拒绝。{idempotencyKey ? ` 幂等键 ${idempotencyKey}` : ''}</small>
      </div>}

      {history.length > 0 && <div className="modal-history">
        <h4>历史交付日调整（审计）</h4>
        {history.map(item => <div className="history-row" key={item.id}>
          <b>{item.snapshot.oldDate} → {item.snapshot.newDate}</b>
          <small>{new Date(item.at).toLocaleString('zh-CN')} · {item.actor} · {item.snapshot.deltaDays > 0 ? '后移' : '提前'} {Math.abs(item.snapshot.deltaDays)} 天{item.snapshot.allowBackward ? ' · 显式批准倒退' : ''}</small>
          <small>{item.snapshot.reason} · 影响 {item.snapshot.milestoneImpacts.length} 里程碑 / {item.snapshot.assetWindowImpacts.length} 授权 / {item.snapshot.approvalImpacts.length} 审批 / {item.snapshot.budgetImpacts.length} 预算</small>
        </div>)}
      </div>}
    </div>
  </div>;
}
