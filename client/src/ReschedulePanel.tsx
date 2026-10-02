import { useEffect, useState } from 'react';

type Severity = 'blocker' | 'critical' | 'warning' | 'info';
type Impact = { category: string; severity: Severity; title: string; detail: string; refId: string };
type Preview = {
  token: string; oldDate: string; newDate: string; reason: string; requestedBy: string;
  direction: 'postpone' | 'advance'; deltaDays: number; canConfirm: boolean;
  requiresRegressionAck: boolean; impacts: Impact[];
  impactCounts: Record<Severity, number>; expiresAt: string;
};
type AuditEntry = { id: string; actor: string; at: string; oldDate: string; newDate: string; reason: string; direction: string; deltaDays: number; impactCounts: Record<Severity, number> };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((body as { message?: string }).message || `请求失败 (${response.status})`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return body as T;
}

const severityLabel: Record<Severity, string> = { blocker: '阻断', critical: '高', warning: '中', info: '提示' };
const severityOrder: Record<Severity, number> = { blocker: 0, critical: 1, warning: 2, info: 3 };
const categoryLabel: Record<string, string> = { project: '项目', contract: '合同里程碑', asset: '资产授权窗口', approval: '在途审批', budget: '预算' };

export default function ReschedulePanel({ projectId, deliveryDate, onApplied }: { projectId: string; deliveryDate: string; onApplied: () => Promise<void> | void }) {
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [ackRegression, setAckRegression] = useState(false);
  const [busy, setBusy] = useState<'none' | 'preview' | 'confirm'>('none');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<AuditEntry[]>([]);

  const loadHistory = () => request<AuditEntry[]>(`/projects/${projectId}/reschedule-audit`).then(setHistory).catch(() => setHistory([]));
  useEffect(() => { setPreview(undefined); setError(''); setNotice(''); setAckRegression(false); void loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const reset = () => { setPreview(undefined); setAckRegression(false); setError(''); setNewDate(''); };

  const doPreview = async () => {
    setBusy('preview'); setError(''); setNotice(''); setPreview(undefined);
    try {
      const result = await request<Preview>(`/projects/${projectId}/reschedule/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newDate, reason }),
      });
      setPreview(result); setAckRegression(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy('none'); }
  };

  const doConfirm = async () => {
    if (!preview) return;
    setBusy('confirm'); setError('');
    try {
      const result = await request<{ applied: boolean; alreadyConfirmed: boolean }>(`/projects/${projectId}/reschedule/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: preview.token, confirmRegression: ackRegression }),
      });
      setNotice(result.alreadyConfirmed ? '该改期此前已生效，本次为重复提交，未重复写入任何变更。' : `交付日已一次性更新为 ${preview.newDate}，审计快照已保存。`);
      reset();
      await onApplied(); // 重新拉取 summary/projects，驾驶舱、预算与版权页共用同一新日期
      await loadHistory();
    } catch (e) { setError((e as Error).message); } finally { setBusy('none'); }
  };

  const doCancel = async () => {
    if (!preview) return;
    try {
      await request(`/projects/${projectId}/reschedule/preview/${preview.token}`, { method: 'DELETE' });
      reset(); setNotice('预览已取消，未发生任何数据变更。');
    } catch (e) { setError((e as Error).message); }
  };

  const sortedImpacts = preview ? [...preview.impacts].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]) : [];

  return <div className="grid">
    <section className="panel wide">
      <div className="panel-head">
        <div><div className="eyebrow">DELIVERY RESCHEDULE / {projectId}</div><h3>海外窗口调整 · 交付日改期</h3></div>
        <span className="badge amber">当前交付日 {deliveryDate}</span>
      </div>
      <p style={{ marginBottom: 14 }}>改期采用<b>预览 — 确认</b>流程：预览只生成影响清单，不修改任何字段；确认后一次性更新交付日并审计旧/新日期、理由与影响快照。</p>
      <div className="reschedule-form">
        <label><small>新交付日</small><input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} disabled={busy !== 'none' || Boolean(preview)}/></label>
        <label className="reason"><small>理由（海外窗口调整说明，必填）</small><input type="text" value={reason} placeholder="例：北美平台档期后移，海外授权窗口顺延" onChange={e => setReason(e.target.value)} disabled={busy !== 'none' || Boolean(preview)} maxLength={500}/></label>
        {!preview && <button onClick={() => void doPreview()} disabled={busy !== 'none' || !newDate || !reason.trim()}>{busy === 'preview' ? '正在计算影响…' : '① 预览影响清单'}</button>}
      </div>
      {notice && <div className="reschedule-notice">{notice}</div>}
      {error && <div className="reschedule-error">{error}</div>}
    </section>

    {preview && <section className="panel wide">
      <div className="panel-head">
        <div>
          <div className="eyebrow">IMPACT PREVIEW / {preview.direction === 'postpone' ? `后移 ${preview.deltaDays} 天` : `提前 ${Math.abs(preview.deltaDays)} 天`}</div>
          <h3>{preview.oldDate} → {preview.newDate}</h3>
        </div>
        <div className="impact-counts">
          {(['blocker', 'critical', 'warning', 'info'] as Severity[]).map(s => <span key={s} className={`impact-chip ${s}`}>{severityLabel[s]} {preview.impactCounts[s]}</span>)}
        </div>
      </div>

      {!preview.canConfirm && <div className="reschedule-error"><b>存在阻断性影响，本次改期无法生效：</b>请先处理下列阻断项，或改走交付回退/重新立项流程。</div>}

      <div className="impact-list">
        {sortedImpacts.map((impact, i) => <div className={`impact-item ${impact.severity}`} key={`${impact.refId}-${i}`}>
          <span className={`risk-tag ${impact.severity}`}>{severityLabel[impact.severity]}</span>
          <div>
            <b>[{categoryLabel[impact.category] ?? impact.category}] {impact.title}</b>
            <small>{impact.detail} · 关联 {impact.refId}</small>
          </div>
        </div>)}
      </div>

      {preview.requiresRegressionAck && <label className="ack-line">
        <input type="checkbox" checked={ackRegression} onChange={e => setAckRegression(e.target.checked)} disabled={busy === 'confirm'}/>
        我已知悉交付日<b>倒退 {Math.abs(preview.deltaDays)} 天</b>会压缩制作与送审窗口，并确认承担上述影响。
      </label>}

      <div className="reschedule-actions">
        <button className="primary" onClick={() => void doConfirm()} disabled={busy === 'confirm' || !preview.canConfirm || (preview.requiresRegressionAck && !ackRegression)}>
          {busy === 'confirm' ? '正在生效…' : '② 确认并一次性生效'}
        </button>
        <button onClick={() => void doCancel()} disabled={busy === 'confirm'}>放弃此预览</button>
        <em>票据 {preview.token.slice(0, 8)}… · 有效至 {new Date(preview.expiresAt).toLocaleString()}</em>
      </div>
    </section>}

    <section className="panel wide">
      <div className="panel-head"><h3>改期审计记录</h3><span>{history.length} 条 · 含旧/新日期、理由与影响快照</span></div>
      {history.length === 0 ? <div className="empty">该项目暂无已生效的交付日改期。</div> :
        <div className="table"><div className="tr th"><span>时间 / 操作人</span><span>旧日期 → 新日期</span><span>方向</span><span>影响(高/中/提示)</span><span>理由</span></div>
          {history.map(e => <div className="tr audit-row" key={e.id}>
            <span><b>{new Date(e.at).toLocaleString()}</b><small>{e.actor} · {e.id}</small></span>
            <span><b>{e.oldDate} → {e.newDate}</b></span>
            <span className={e.direction === 'advance' ? 'bad' : ''}>{e.direction === 'advance' ? `提前 ${Math.abs(e.deltaDays)} 天` : `后移 ${e.deltaDays} 天`}</span>
            <span>{e.impactCounts.critical} / {e.impactCounts.warning} / {e.impactCounts.info}</span>
            <span className="audit-reason">{e.reason}</span>
          </div>)}
        </div>}
    </section>
  </div>;
}
