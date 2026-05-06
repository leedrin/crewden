import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { CreateChannelRequestSchema, SearchRequestSchema } from '@crewden/shared';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';

export async function channelRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { projectId?: string } }>('/api/channels', async (req) => {
    return getStore().listChannels({ projectId: req.query.projectId });
  });

  app.post('/api/channels', async (req, reply) => {
    const parsed = CreateChannelRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = (await getStore().listChannels({ projectId: parsed.data.projectId })).find((channel) => channel.name === parsed.data.name);
    if (existing) return reply.status(409).send({ error: 'Channel name already exists' });
    const project = await getStore().getProject(parsed.data.projectId);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const channel = await getStore().createChannel(nanoid(), parsed.data.name, parsed.data.projectId);
    eventBus.emit({ type: 'channel:created', channel });
    return reply.status(201).send(channel);
  });

  app.delete<{ Params: { id: string } }>('/api/channels/:id', async (req, reply) => {
    if (req.params.id === 'general') return reply.status(400).send({ error: 'Cannot delete general channel' });
    const deleted = await getStore().deleteChannel(req.params.id);
    if (!deleted) return reply.status(404).send({ error: 'Channel not found' });
    eventBus.emit({ type: 'channel:deleted', channelId: req.params.id });
    return reply.status(204).send();
  });

  app.get<{ Querystring: { q?: string; projectId?: string; limit?: string } }>('/api/search', async (req, reply) => {
    const parsed = SearchRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    return { messages: await getStore().searchMessages(parsed.data.q, parsed.data.limit, parsed.data.projectId) };
  });

  app.get<{ Params: { id: string } }>('/api/channels/:id/messages', async (req, reply) => {
    const channel = await getStore().getChannel(req.params.id);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    return getStore().listMessages(req.params.id);
  });
}
