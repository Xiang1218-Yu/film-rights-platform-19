import express, { type NextFunction, type Request, type Response } from 'express';
import { approve, assets, budgetLines, confirmDeliveryReschedule, contracts, createApproval, dashboard, deliveryRescheduleAudit, hasIdempotencyRecord, previewDeliveryReschedule, projectSummary, projects, resetDemoState, rightsConflicts, RescheduleError, setDependencyCalculationFailure } from './domain.js';

const app = express(); app.use(express.json());
app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
app.get('/api/projects/:id/delivery-audit', (req, res) => res.json(deliveryRescheduleAudit(req.params.id)));
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(budgetLines.filter(line => line.projectId === req.params.projectId)));
app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
app.patch('/api/approvals/:id', (req, res) => { const result = approve(req.params.id, req.body.status, req.body.comment); if (!result) return res.status(404).json({ message: '审批不存在' }); res.json(result); });

// 交付日“预览—确认”：预览只算影响清单，确认凭一次性令牌生效。
app.post('/api/projects/:id/delivery-reschedule/preview', (req, res, next) => {
  try {
    const preview = previewDeliveryReschedule({ projectId: req.params.id, newDate: req.body.newDate, reason: req.body.reason, allowBackward: req.body.allowBackward === true, actor: req.body.actor });
    res.status(201).json(preview);
  } catch (error) { next(error); }
});
app.post('/api/delivery-reschedule/:previewId/confirm', (req, res, next) => {
  try {
    const idempotencyKey = req.header('idempotency-key') || req.body.idempotencyKey || undefined;
    const replayed = Boolean(idempotencyKey && hasIdempotencyRecord(idempotencyKey));
    const result = confirmDeliveryReschedule({ previewId: req.params.previewId, idempotencyKey, actor: req.body.actor });
    res.setHeader('idempotent-replay', String(replayed));
    res.status(200).json(result);
  } catch (error) { next(error); }
});
// 演练/测试钩子：模拟依赖计算故障；重置演示内存仓储。
app.post('/api/test-hooks/dependency-failure', (req, res) => { setDependencyCalculationFailure(req.body.enabled !== false); res.json({ ok: true, failNext: true }); });
app.post('/api/test-hooks/reset', (_req, res) => { resetDemoState(); res.json({ ok: true }); });

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof RescheduleError) return res.status(error.statusCode).json({ message: error.message, code: error.name });
  console.error(error);
  res.status(500).json({ message: '服务内部错误' });
});

const port = Number(process.env.PORT || 4104); app.listen(port, () => console.log(`film rights API listening on ${port}`));
