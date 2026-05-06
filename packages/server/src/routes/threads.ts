import type { FastifyInstance } from 'fastify';
import { getStore } from '../db.js';

export async function threadRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/threads/:id', async (req, reply) => {
    const thread = await getStore().getThread(req.params.id);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    return thread;
  });

  app.post<{ Params: { id: string } }>('/api/threads/:id/resolve', async (req, reply) => {
    const store = getStore();
    const updated = await store.setThreadStatus(req.params.id, 'resolved');
    if (!updated) return reply.status(404).send({ error: 'Thread not found' });
    const thread = await store.getThread(req.params.id);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    return thread;
  });

  app.post<{ Params: { id: string } }>('/api/threads/:id/reopen', async (req, reply) => {
    const store = getStore();
    const updated = await store.setThreadStatus(req.params.id, 'active');
    if (!updated) return reply.status(404).send({ error: 'Thread not found' });
    const thread = await store.getThread(req.params.id);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    return thread;
  });

  app.get<{ Params: { id: string } }>('/api/threads/:id/summary', async (req, reply) => {
    const thread = await getStore().getThread(req.params.id);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    return {
      threadId: thread.root.id,
      status: thread.status ?? 'active',
      messageCount: thread.messageCount ?? (1 + thread.replies.length),
      participants: thread.participants ?? [],
      summaryContent: thread.summaryContent ?? '',
      summaryGeneratedAt: thread.summaryGeneratedAt,
      resolvedAt: thread.resolvedAt,
    };
  });
}
