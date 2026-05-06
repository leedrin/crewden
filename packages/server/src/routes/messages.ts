import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { CreateMessageRequestSchema, type Agent, type Mention } from '@crewden/shared';
import { toAgentDelivery } from '@crewden/hub-core';
import { buildOpenTaskSummary } from '../taskDelivery.js';
import { paseoRuntimeService } from '../runtime/paseo-runtime-service.js';
import { cacheIdempotentMessage, deliverWithRetry, getCachedIdempotentMessage } from '../runtime/delivery-reliability.js';
import { isRuntimeSupported, markUnsupportedRuntime } from '../runtime/runtime-support.js';
import { canAgentWriteChannel } from '../agentPermissions.js';
import { resolveActingAgent } from '../requestAgentAuth.js';

export async function messageRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/channels/:id/messages', async (req, reply) => {
    const store = getStore();
    const channel = await store.getChannel(req.params.id);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const actingAgent = await resolveActingAgent(req, reply);
    if (reply.sent) return reply;
    if (actingAgent && !(await canAgentWriteChannel(actingAgent.id, channel.id))) {
      return reply.status(403).send({ error: 'Agent does not have permission: write_channels' });
    }

    const parsed = CreateMessageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const { senderName, content, agentId, actorType, actorId, threadRootId } = parsed.data;
    const idempotencyHeader = req.headers['x-idempotency-key'];
    const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader.trim() : '';
    if (idempotencyKey) {
      const cached = getCachedIdempotentMessage(
        `channel:${req.params.id}:sender:${senderName}:key:${idempotencyKey}`,
      );
      if (cached) {
        return reply.status(200).send(cached);
      }
    }
    let normalizedThreadRootId = threadRootId;
    if (threadRootId) {
      const thread = await store.getThread(threadRootId);
      if (!thread) return reply.status(404).send({ error: 'Thread root not found' });
      if (thread.root.channelId !== req.params.id) return reply.status(400).send({ error: 'Thread root belongs to another channel' });
      normalizedThreadRootId = thread.root.id;
    }

    const mentions = parseMentions(content, await store.listAgents());
    const message = await store.createMessage({
      id: nanoid(),
      projectId: channel.projectId,
      channelId: req.params.id,
      senderName,
      content,
      agentId,
      actorType: actorType ?? (agentId ? 'agent' : 'human'),
      actorId: actorId ?? agentId ?? senderName,
      threadRootId: normalizedThreadRootId,
      mentions,
    });
    if (idempotencyKey) {
      cacheIdempotentMessage(
        `channel:${req.params.id}:sender:${senderName}:key:${idempotencyKey}`,
        message,
      );
    }

    if (message.threadRootId) {
      const thread = await store.getThread(message.threadRootId);
      if (thread) eventBus.emit({ type: 'thread:message:new', root: thread.root, message });
    } else {
      eventBus.emit({ type: 'message:new', message });
    }

    const targetAgentIds = new Set<string>();
    if (agentId) targetAgentIds.add(agentId);
    for (const mention of mentions ?? []) {
      if (mention.type === 'agent') targetAgentIds.add(mention.id);
    }

    for (const targetAgentId of targetAgentIds) {
      const agent = await store.getAgent(targetAgentId);
      if (agent && agent.status !== 'inactive') {
        if (!isRuntimeSupported(agent.runtime)) {
          await markUnsupportedRuntime(agent, 'channel-message-delivery');
          continue;
        }
        await deliverWithRetry(agent, 'channel-message-delivery', async () => paseoRuntimeService.deliverMessage({
          target: agent,
          seq: Date.now(),
          message: toAgentDelivery(message, channel),
          channelId: channel.id,
          inboxSummary: await buildOpenTaskSummary(agent),
        }));
      }
    }

    return reply.status(201).send(message);
  });

  app.get<{ Params: { id: string } }>('/api/messages/:id/thread', async (req, reply) => {
    const thread = await getStore().getThread(req.params.id);
    if (!thread) return reply.status(404).send({ error: 'Message not found' });
    return thread;
  });
}

function parseMentions(content: string, agents: Agent[]): Mention[] | undefined {
  const mentions = new Map<string, Mention>();
  if (/@user\b/.test(content)) mentions.set('user:user', { type: 'user', id: 'user', label: 'user' });
  for (const agent of agents) {
    const labels = [agent.displayName, agent.name].filter(Boolean) as string[];
    for (const label of labels) {
      if (content.includes(`@${label}`)) {
        mentions.set(`agent:${agent.id}`, { type: 'agent', id: agent.id, label });
        break;
      }
    }
  }
  return mentions.size ? [...mentions.values()] : undefined;
}
