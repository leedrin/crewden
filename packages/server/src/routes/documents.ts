import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { ApproveDocumentRequestSchema, CreateDocumentRequestSchema, DocumentKindSchema, DocumentStatusSchema, DecisionTransitionRequestSchema, PatchDocumentRequestSchema, SubmitDocumentReviewRequestSchema } from '@crewden/shared';
import { getStore } from '../db.js';

export async function documentRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { projectId?: string; kind?: string; status?: string; channelId?: string } }>('/api/documents', async (req, reply) => {
    const kind = req.query.kind === undefined ? undefined : DocumentKindSchema.safeParse(req.query.kind);
    if (kind && !kind.success) return reply.status(400).send({ error: 'Invalid document kind' });
    const status = req.query.status === undefined ? undefined : DocumentStatusSchema.safeParse(req.query.status);
    if (status && !status.success) return reply.status(400).send({ error: 'Invalid document status' });
    return getStore().listDocuments({
      projectId: req.query.projectId,
      sourceChannelId: req.query.channelId,
      kind: kind?.success ? kind.data : undefined,
      status: status?.success ? status.data : undefined,
    });
  });

  app.post('/api/documents', async (req, reply) => {
    const parsed = CreateDocumentRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await getStore().getChannel(parsed.data.sourceChannelId, { projectId: parsed.data.projectId });
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const document = await getStore().createDocument({
      id: nanoid(),
      projectId: channel.projectId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      status: 'draft',
      content: parsed.data.content,
      sourceThreadId: parsed.data.sourceThreadId,
      sourceChannelId: parsed.data.sourceChannelId,
      author: { actorType: parsed.data.authorType, actorId: parsed.data.authorId },
      authorName: parsed.data.authorName,
      reviewers: [],
      relatedDecisions: parsed.data.relatedDecisions,
      relatedTasks: parsed.data.relatedTasks,
    });
    await getStore().appendAuditLog({
      projectId: document.projectId,
      actorType: parsed.data.authorType,
      actorId: parsed.data.authorId,
      action: 'document.created',
      entityType: 'document',
      entityId: document.id,
      detailJson: { kind: document.kind, status: document.status, sourceChannelId: document.sourceChannelId },
    });
    return reply.status(201).send(document);
  });

  app.get<{ Params: { id: string } }>('/api/documents/:id', async (req, reply) => {
    const document = await getStore().getDocument(req.params.id);
    if (!document) return reply.status(404).send({ error: 'Document not found' });
    return document;
  });

  app.patch<{ Params: { id: string } }>('/api/documents/:id', async (req, reply) => {
    const parsed = PatchDocumentRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = await getStore().getDocument(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    const updated = await getStore().updateDocument(existing.id, parsed.data);
    if (!updated) return reply.status(404).send({ error: 'Document not found' });
    await getStore().appendAuditLog({
      projectId: updated.projectId,
      actorType: 'human',
      actorId: 'user',
      action: 'document.updated',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { fields: Object.keys(parsed.data) },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/documents/:id/submit-review', async (req, reply) => {
    const parsed = SubmitDocumentReviewRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = await getStore().getDocument(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (existing.status !== 'draft') return reply.status(422).send({ error: 'Only draft documents can be submitted for review' });
    const updated = await getStore().updateDocument(existing.id, { status: 'in_review', reviewers: parsed.data.reviewers });
    if (!updated) return reply.status(404).send({ error: 'Document not found' });
    await getStore().appendAuditLog({
      projectId: updated.projectId,
      actorType: 'human',
      actorId: 'user',
      action: 'document.status_changed',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status, reviewers: parsed.data.reviewers.map((reviewer) => reviewer.actorId) },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/documents/:id/approve', async (req, reply) => {
    const parsed = ApproveDocumentRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = await getStore().getDocument(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (existing.status !== 'in_review') return reply.status(422).send({ error: 'Only in_review documents can be approved' });
    const reviewers = existing.reviewers ?? [];
    const allowed = reviewers.some((reviewer) => reviewer.actorType === parsed.data.actorType && reviewer.actorId === parsed.data.actorId);
    if (!allowed) return reply.status(403).send({ error: 'Approver must be in reviewers list' });
    const updated = await getStore().updateDocument(existing.id, { status: 'approved', approvedAt: new Date().toISOString() });
    if (!updated) return reply.status(404).send({ error: 'Document not found' });
    await getStore().appendAuditLog({
      projectId: updated.projectId,
      actorType: parsed.data.actorType,
      actorId: parsed.data.actorId,
      action: 'document.status_changed',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/documents/:id/deprecate', async (req, reply) => {
    const existing = await getStore().getDocument(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (existing.status !== 'approved') return reply.status(422).send({ error: 'Only approved documents can be deprecated' });
    const updated = await getStore().updateDocument(existing.id, { status: 'deprecated' });
    if (!updated) return reply.status(404).send({ error: 'Document not found' });
    await getStore().appendAuditLog({
      projectId: updated.projectId,
      actorType: 'human',
      actorId: 'user',
      action: 'document.status_changed',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/documents/:id/supersede', async (req, reply) => {
    const parsed = DecisionTransitionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (!parsed.data.supersededBy) return reply.status(400).send({ error: 'supersededBy is required' });
    const existing = await getStore().getDocument(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Document not found' });
    if (existing.status !== 'approved') return reply.status(422).send({ error: 'Only approved documents can be superseded' });
    const replacement = await getStore().getDocument(parsed.data.supersededBy);
    if (!replacement) return reply.status(404).send({ error: 'Superseding document not found' });
    const updated = await getStore().updateDocument(existing.id, { status: 'superseded', supersededBy: replacement.id });
    if (!updated) return reply.status(404).send({ error: 'Document not found' });
    await getStore().appendAuditLog({
      projectId: updated.projectId,
      actorType: 'human',
      actorId: 'user',
      action: 'document.status_changed',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status, supersededBy: replacement.id },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/messages/:id/to-document', async (req, reply) => {
    const message = await getStore().getMessage(req.params.id);
    if (!message) return reply.status(404).send({ error: 'Message not found' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = typeof body.kind === 'string' ? body.kind : 'adr';
    const parsedKind = DocumentKindSchema.safeParse(kind);
    if (!parsedKind.success) return reply.status(400).send({ error: 'Invalid document kind' });
    const document = await getStore().createDocument({
      id: nanoid(),
      projectId: message.projectId,
      kind: parsedKind.data,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : message.content.slice(0, 120),
      status: 'draft',
      content: typeof body.content === 'string' ? body.content : message.content,
      sourceThreadId: message.threadRootId ?? message.id,
      sourceChannelId: message.channelId,
      author: { actorType: 'human', actorId: 'user' },
      authorName: 'user',
      reviewers: [],
      relatedDecisions: Array.isArray(body.relatedDecisions) ? body.relatedDecisions.filter((item): item is string => typeof item === 'string') : [],
      relatedTasks: Array.isArray(body.relatedTasks) ? body.relatedTasks.filter((item): item is string => typeof item === 'string') : [],
    });
    await getStore().appendAuditLog({
      projectId: document.projectId,
      actorType: 'human',
      actorId: 'user',
      action: 'document.created',
      entityType: 'document',
      entityId: document.id,
      detailJson: { kind: document.kind, sourceThreadId: document.sourceThreadId },
    });
    return reply.status(201).send(document);
  });
}
