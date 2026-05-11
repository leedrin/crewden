import type { FastifyInstance } from 'fastify';
import { CreateApprovalRequestSchema, RespondApprovalRequestSchema, type ApprovalStatus, type ApprovalType } from '@crewden/shared';
import { getDb } from '../db.js';
import { SqliteApprovalRepository } from '../repository/approval.repository.js';
import { eventBus } from '../events.js';

function getApprovalRepo() {
  return new SqliteApprovalRepository(getDb());
}

export async function approvalRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { targetId?: string; type?: string; status?: string } }>('/api/approvals', async (req) => {
    return getApprovalRepo().list({
      targetId: req.query.targetId,
      type: req.query.type as ApprovalType | undefined,
      status: req.query.status as ApprovalStatus | undefined,
    });
  });

  app.post('/api/approvals', async (req, reply) => {
    const parsed = CreateApprovalRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const approval = await getApprovalRepo().create({
      projectId: parsed.data.projectId,
      type: parsed.data.type,
      targetId: parsed.data.targetId,
      requestedByType: 'agent',
      requestedById: 'system',
      reason: parsed.data.reason,
      context: parsed.data.context,
      expiresAt: parsed.data.expiresAt,
    });

    eventBus.emit({ type: 'approval:update', approval });
    return reply.status(201).send(approval);
  });

  app.get('/api/approvals/pending', async () => {
    return getApprovalRepo().list({ status: 'pending' });
  });

  app.post<{ Params: { id: string } }>('/api/approvals/:id/approve', async (req, reply) => {
    const parsed = RespondApprovalRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const repo = getApprovalRepo();
    const existing = await repo.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Approval not found' });
    if (existing.status !== 'pending') return reply.status(422).send({ error: `Cannot approve approval in ${existing.status} status` });

    const updated = await repo.respond(req.params.id, {
      approvedByType: 'human',
      approvedById: 'user',
      approved: true,
      comment: parsed.data.comment,
    });

    if (updated) eventBus.emit({ type: 'approval:update', approval: updated });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/approvals/:id/reject', async (req, reply) => {
    const parsed = RespondApprovalRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const repo = getApprovalRepo();
    const existing = await repo.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Approval not found' });
    if (existing.status !== 'pending') return reply.status(422).send({ error: `Cannot reject approval in ${existing.status} status` });

    const updated = await repo.respond(req.params.id, {
      approvedByType: 'human',
      approvedById: 'user',
      approved: false,
      comment: parsed.data.comment,
    });

    if (updated) eventBus.emit({ type: 'approval:update', approval: updated });
    return updated;
  });
}
