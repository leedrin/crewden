import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { DecisionStatusSchema, CreateDecisionRequestSchema, DecisionTransitionRequestSchema, PatchDecisionRequestSchema } from '@crewden/shared';
import { getStore } from '../db.js';

export async function decisionRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { projectId?: string; channelId?: string; status?: string } }>('/api/decisions', async (req, reply) => {
    const status = req.query.status === undefined ? undefined : DecisionStatusSchema.safeParse(req.query.status);
    if (status && !status.success) return reply.status(400).send({ error: 'Invalid decision status' });
    return getStore().listDecisions({
      projectId: req.query.projectId,
      channelId: req.query.channelId,
      status: status?.success ? status.data : undefined,
    });
  });

  app.get<{ Params: { id: string }; Querystring: { status?: string } }>('/api/channels/:id/decisions', async (req, reply) => {
    const status = req.query.status === undefined ? undefined : DecisionStatusSchema.safeParse(req.query.status);
    if (status && !status.success) return reply.status(400).send({ error: 'Invalid decision status' });
    const channel = await getStore().getChannel(req.params.id);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    return getStore().listDecisions({
      projectId: channel.projectId,
      channelId: channel.id,
      status: status?.success ? status.data : undefined,
    });
  });

  app.post('/api/decisions', async (req, reply) => {
    const parsed = CreateDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (parsed.data.status !== 'proposed') return reply.status(422).send({ error: 'Decision must start in proposed status' });
    const channel = await getStore().getChannel(parsed.data.channelId, { projectId: parsed.data.projectId });
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const decision = await getStore().createDecision({
      id: nanoid(),
      projectId: channel.projectId,
      channelId: parsed.data.channelId,
      sourceThreadId: parsed.data.sourceThreadId,
      title: parsed.data.title,
      status: 'proposed',
      problem: parsed.data.problem,
      alternatives: parsed.data.alternatives,
      decisionText: parsed.data.decisionText,
      rationale: parsed.data.rationale,
      consequences: parsed.data.consequences,
      participants: parsed.data.participants,
      relatedDecisions: parsed.data.relatedDecisions,
    });
    await getStore().appendAuditLog({
      projectId: decision.projectId,
      actorType: 'human',
      actorId: 'user',
      action: 'decision.created',
      entityType: 'decision',
      entityId: decision.id,
      detailJson: { status: decision.status, channelId: decision.channelId },
    });
    return reply.status(201).send(decision);
  });

  app.get<{ Params: { id: string } }>('/api/decisions/:id', async (req, reply) => {
    const decision = await getStore().getDecision(req.params.id);
    if (!decision) return reply.status(404).send({ error: 'Decision not found' });
    return decision;
  });

  app.patch<{ Params: { id: string } }>('/api/decisions/:id', async (req, reply) => {
    const parsed = PatchDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = await getStore().getDecision(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Decision not found' });
    if (parsed.data.status && parsed.data.status !== existing.status) {
      if (!(existing.status === 'proposed' && parsed.data.status === 'accepted')) {
        return reply.status(422).send({ error: 'Invalid decision status transition', from: existing.status, to: parsed.data.status });
      }
    }
    const updated = await getStore().updateDecision(existing.id, {
      ...parsed.data,
      acceptedAt: parsed.data.status === 'accepted' ? new Date().toISOString() : existing.acceptedAt,
    });
    if (!updated) return reply.status(404).send({ error: 'Decision not found' });
    await getStore().appendAuditLog({
      projectId: updated.projectId,
      actorType: 'human',
      actorId: 'user',
      action: parsed.data.status ? 'decision.status_changed' : 'decision.updated',
      entityType: 'decision',
      entityId: updated.id,
      detailJson: parsed.data.status ? { from: existing.status, to: updated.status } : { fields: Object.keys(parsed.data) },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/decisions/:id/deprecate', async (req, reply) => {
    const existing = await getStore().getDecision(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Decision not found' });
    if (existing.status !== 'accepted') return reply.status(422).send({ error: 'Only accepted decisions can be deprecated' });
    const updated = await getStore().updateDecision(existing.id, { status: 'deprecated' });
    if (!updated) return reply.status(404).send({ error: 'Decision not found' });
    await getStore().appendAuditLog({
      projectId: updated.projectId,
      actorType: 'human',
      actorId: 'user',
      action: 'decision.status_changed',
      entityType: 'decision',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/decisions/:id/supersede', async (req, reply) => {
    const parsed = DecisionTransitionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (!parsed.data.supersededBy) return reply.status(400).send({ error: 'supersededBy is required' });
    const existing = await getStore().getDecision(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Decision not found' });
    if (existing.status !== 'accepted') return reply.status(422).send({ error: 'Only accepted decisions can be superseded' });
    const replacement = await getStore().getDecision(parsed.data.supersededBy);
    if (!replacement) return reply.status(404).send({ error: 'Superseding decision not found' });
    const updated = await getStore().updateDecision(existing.id, { status: 'superseded', supersededBy: replacement.id });
    if (!updated) return reply.status(404).send({ error: 'Decision not found' });
    await getStore().appendAuditLog({
      projectId: updated.projectId,
      actorType: 'human',
      actorId: 'user',
      action: 'decision.status_changed',
      entityType: 'decision',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status, supersededBy: replacement.id },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/messages/:id/to-decision', async (req, reply) => {
    const message = await getStore().getMessage(req.params.id);
    if (!message) return reply.status(404).send({ error: 'Message not found' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : message.content.slice(0, 120);
    const problem = typeof body.problem === 'string' && body.problem.trim() ? body.problem.trim() : message.content.slice(0, 500);
    const decisionText = typeof body.decisionText === 'string' && body.decisionText.trim() ? body.decisionText.trim() : message.content.slice(0, 500);
    const decision = await getStore().createDecision({
      id: nanoid(),
      projectId: message.projectId,
      channelId: message.channelId,
      sourceThreadId: message.threadRootId ?? message.id,
      title,
      status: 'proposed',
      problem,
      decisionText,
      alternatives: Array.isArray(body.alternatives) ? body.alternatives.filter((item): item is string => typeof item === 'string') : [],
      rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
      consequences: Array.isArray(body.consequences) ? body.consequences.filter((item): item is string => typeof item === 'string') : [],
      relatedDecisions: [],
      participants: [],
    });
    await getStore().appendAuditLog({
      projectId: decision.projectId,
      actorType: 'human',
      actorId: 'user',
      action: 'decision.created',
      entityType: 'decision',
      entityId: decision.id,
      detailJson: { status: decision.status, sourceThreadId: decision.sourceThreadId },
    });
    return reply.status(201).send(decision);
  });
}
