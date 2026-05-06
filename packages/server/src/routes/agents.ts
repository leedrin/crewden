import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { AgentCapabilitySchema, AgentRoleSchema, CreateAgentDelegationRequestSchema, CreateAgentRequestSchema, CreateDirectMessageRequestSchema, CreateReminderRequestSchema, PatchAgentRequestSchema, PatchReminderRequestSchema, type Agent, type DirectMessage } from '@crewden/shared';
import { delegateAgent } from '../delegation.js';
import { buildOpenTaskSummary } from '../taskDelivery.js';
import { validateAgentPatch } from '../runtime/validate-agent-patch.js';
import { paseoRuntimeService } from '../runtime/paseo-runtime-service.js';
import { deliverWithRetry } from '../runtime/delivery-reliability.js';
import { isRuntimeSupported, markUnsupportedRuntime, unsupportedRuntimeError } from '../runtime/runtime-support.js';

export async function agentRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { projectId?: string; role?: string; capability?: string } }>('/api/agents', async (req, reply) => {
    const role = req.query.role ? AgentRoleSchema.safeParse(req.query.role) : undefined;
    if (role && !role.success) return reply.status(400).send({ error: 'Invalid role' });
    const capability = req.query.capability ? AgentCapabilitySchema.safeParse(req.query.capability) : undefined;
    if (capability && !capability.success) return reply.status(400).send({ error: 'Invalid capability' });
    return getStore().listAgents({
      projectId: req.query.projectId,
      role: role?.success ? role.data : undefined,
      capability: capability?.success ? capability.data : undefined,
    });
  });

  app.get<{ Querystring: { role?: string; capabilities?: string; excludeAgentId?: string; mustBeIdle?: string; maxResults?: string } }>('/api/agents/resolve', async (req, reply) => {
    const role = req.query.role ? AgentRoleSchema.safeParse(req.query.role) : undefined;
    if (role && !role.success) return reply.status(400).send({ error: 'Invalid role' });
    const capabilities = (req.query.capabilities ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const normalizedCapabilities: Array<ReturnType<typeof AgentCapabilitySchema.parse>> = [];
    for (const capability of capabilities) {
      const parsed = AgentCapabilitySchema.safeParse(capability);
      if (!parsed.success) return reply.status(400).send({ error: `Invalid capability: ${capability}` });
      normalizedCapabilities.push(parsed.data);
    }
    const mustBeIdle = req.query.mustBeIdle === undefined
      ? undefined
      : req.query.mustBeIdle === 'true' || req.query.mustBeIdle === '1';
    const maxResults = req.query.maxResults ? Number(req.query.maxResults) : undefined;
    if (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults <= 0)) {
      return reply.status(400).send({ error: 'Invalid maxResults' });
    }
    return getStore().resolveAgentsByProfile({
      role: role?.success ? role.data : undefined,
      capabilities: normalizedCapabilities.length > 0 ? normalizedCapabilities : undefined,
      excludeAgentId: req.query.excludeAgentId,
      mustBeIdle,
      maxResults,
    });
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return agent;
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id/activities', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listAgentActivities(agent.id, 200);
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id/reminders', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listReminders({ projectId: agent.projectId, agentId: agent.id });
  });

  app.post<{ Params: { id: string } }>('/api/agents/:id/reminders', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = CreateReminderRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await store.getChannel(parsed.data.channelId);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const reminder = await store.createReminder({
      id: nanoid(),
      projectId: agent.projectId,
      agentId: agent.id,
      channelId: channel.id,
      message: parsed.data.message,
      triggerAt: parsed.data.triggerAt,
      status: 'pending',
    });
    eventBus.emit({ type: 'reminder:update', reminder });
    return reply.status(201).send(reminder);
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/agents/:id/workspace', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    const relPath = req.query.path ?? '';
    if (isUnsafeWorkspacePath(relPath)) {
      return reply.status(403).send({ error: 'Path traversal is not allowed' });
    }
    const result = await paseoRuntimeService.readWorkspace(agent, relPath);
    if (result.type === 'error') {
      return reply.status(result.status ?? 500).send({ error: result.error });
    }
    return result;
  });

  app.post('/api/agents', async (req, reply) => {
    const parsed = CreateAgentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const { projectId, name, displayName, description, runtime, model, systemPrompt, machineId, organization, role, responsibilities, capabilities, workingStyle, handoffPreference, constraints, examples, permissions } = parsed.data;
    const project = await getStore().getProject(projectId);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    if (!isRuntimeSupported(runtime)) {
      return reply.status(422).send({ error: unsupportedRuntimeError(runtime) });
    }

    const agent = await getStore().createAgent({
      id: nanoid(),
      projectId,
      name,
      displayName,
      description,
      runtime,
      model,
      systemPrompt,
      role: role ?? 'unassigned',
      responsibilities,
      capabilities,
      workingStyle,
      handoffPreference,
      constraints,
      examples,
      permissions,
      organization,
      machineId,
      status: 'inactive',
      autoStart: false,
      createdAt: new Date().toISOString(),
    });
    return reply.status(201).send(agent);
  });

  app.patch<{ Params: { id: string } }>('/api/reminders/:id', async (req, reply) => {
    const parsed = PatchReminderRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const reminder = await getStore().updateReminder(req.params.id, { status: parsed.data.status });
    if (!reminder) return reply.status(404).send({ error: 'Reminder not found' });
    eventBus.emit({ type: 'reminder:update', reminder });
    return reminder;
  });

  app.patch<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = PatchAgentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const runtimeError = validateAgentPatch(agent, parsed.data);
    if (runtimeError) return reply.status(runtimeError.statusCode).send({ error: runtimeError.error });
    const updated = await store.updateAgent(agent.id, parsed.data);
    if (updated) {
      eventBus.emit({ type: 'agent:update', agent: updated });
      eventBus.emit({ type: 'agent:updated', agent: updated });
    }
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (agent.status === 'working') {
      return reply.status(409).send({ error: 'Cannot delete agent while it is working. Stop the agent first.' });
    }

    if (agent.status !== 'inactive') {
      await paseoRuntimeService.stopAgent(agent);
    }
    await store.deleteAgent(agent.id);
    eventBus.emit({ type: 'agent:deleted', agentId: agent.id });
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id/dms', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listDirectMessageThreads(agent.id);
  });

  app.get<{ Params: { id: string; otherId: string } }>('/api/agents/:id/dms/:otherId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listDirectMessages(agent.id, req.params.otherId);
  });

  app.post<{ Params: { id: string; otherId: string } }>('/api/agents/:id/dms/:otherId', async (req, reply) => {
    const store = getStore();
    const target = await store.getAgent(req.params.id);
    if (!target) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = CreateDirectMessageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    const dm = await store.createDirectMessage({
      id: nanoid(),
      fromAgentId: parsed.data.fromAgentId ?? req.params.otherId,
      toAgentId: target.id,
      content: parsed.data.content,
    });
    eventBus.emit({ type: 'dm:new', dm });
    await deliverDirectMessage(target, dm);
    return reply.status(201).send(dm);
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id/delegations', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listAgentDelegations(agent.id);
  });

  app.post<{ Params: { id: string; otherId: string } }>('/api/agents/:id/delegate/:otherId', async (req, reply) => {
    const store = getStore();
    const from = await store.getAgent(req.params.id);
    if (!from) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = CreateAgentDelegationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    const delegation = await delegateAgent({
      fromAgentId: from.id,
      toAgentId: req.params.otherId,
      content: parsed.data.content,
      startIfInactive: parsed.data.startIfInactive,
    });
    return reply.status(delegation.status === 'failed' ? 202 : 201).send(delegation);
  });

  app.post<{ Params: { id: string } }>('/api/agents/:id/start', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (!isRuntimeSupported(agent.runtime)) {
      await markUnsupportedRuntime(agent, 'start-agent');
      return reply.status(422).send({ error: unsupportedRuntimeError(agent.runtime) });
    }
    const machineId = paseoRuntimeService.resolveStartMachineId(agent);
    if (!machineId) return reply.status(503).send({ error: 'No connected machine available for agent runtime' });

    const launchId = nanoid();
    const inboxSummary = await buildOpenTaskSummary(agent);
    const sent = await paseoRuntimeService.startAgent({
      agent,
      machineId,
      launchId,
      inboxSummary,
    });

    if (!sent) return reply.status(503).send({ error: 'Machine not connected' });

    const updated = (await store.updateAgent(agent.id, { machineId, autoStart: true }))!;
    eventBus.emit({ type: 'agent:update', agent: updated });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/api/agents/:id/stop', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    await paseoRuntimeService.stopAgent(agent);
    const updated = (await store.updateAgent(agent.id, { status: 'inactive', autoStart: false }))!;
    eventBus.emit({ type: 'agent:update', agent: updated });
    return updated;
  });
}

function isUnsafeWorkspacePath(value: string): boolean {
  return value.startsWith('/') || value.split(/[\\/]+/).some((part) => part === '..');
}

async function deliverDirectMessage(target: Agent, dm: DirectMessage): Promise<void> {
  if (target.status === 'inactive') return;
  if (!isRuntimeSupported(target.runtime)) {
    await markUnsupportedRuntime(target, 'deliver-direct-message');
    return;
  }
  await deliverWithRetry(target, 'deliver-direct-message', async () => paseoRuntimeService.deliverMessage({
    target,
    seq: Date.now(),
    channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
    message: {
      id: dm.id,
      channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
      channelName: `DM from ${dm.fromAgentId}`,
      senderName: dm.fromAgentId,
      content: dm.content,
      createdAt: dm.createdAt,
    },
    inboxSummary: await buildOpenTaskSummary(target),
  }));
}
