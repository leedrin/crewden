import type { FastifyInstance, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import {
  createVersionInfo,
  ConfirmGoalAlignmentRequestSchema,
  CreateKnowledgeEntryRequestSchema,
  CreateReminderRequestSchema,
  CreateTaskReviewRequestSchema,
  InternalGoalCreateRequestSchema,
  InternalGoalCreateTasksRequestSchema,
  InternalGoalListRequestSchema,
  InternalGoalAlignRequestSchema,
  InternalGoalAlignmentPatchRequestSchema,
  InternalAgentDelegateRequestSchema,
  InternalAgentResolveRequestSchema,
  InternalDmSendRequestSchema,
  InternalInboxRequestSchema,
  InternalMessageReadRequestSchema,
  InternalMessageSendRequestSchema,
  InternalTaskHandoffRequestSchema,
  InternalTaskBlockRequestSchema,
  InternalTaskEscalateRequestSchema,
  InternalTaskListRequestSchema,
  InternalTaskCreateRequestSchema,
  InternalTaskProgressRequestSchema,
  InternalTaskUpdateRequestSchema,
  InternalReviewListRequestSchema,
  InternalChannelCreateRequestSchema,
  PatchAgentRequestSchema,
  PatchReminderRequestSchema,
  ReviewDecisionRequestSchema,
  SearchKnowledgeRequestSchema,
  type GoalAlignment,
  type AgentInboxItem,
  type Agent,
  type DirectMessage,
  type Task,
  type TaskStatus,
  type TaskProgressEventType,
  type TaskReview,
} from '@crewden/shared';
import { buildClarifyingQuestions, inferGoalRiskLevel, recommendAgentsForGoal } from '@crewden/hub-core';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { delegateAgent } from '../delegation.js';
import { buildOpenTaskSummary, notifyTaskAssignee } from '../taskDelivery.js';
import { matchesAgentCapability } from '../taskMatching.js';
import { archiveGoal } from './knowledge.js';
import { validateAgentPatch } from '../runtime/validate-agent-patch.js';
import { deliverToAgent } from '../runtime/delivery.js';
import { canAgentWriteChannel, requireAgentPermission } from '../agentPermissions.js';

export async function internalAgentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/internal/agent/')) return;
    const agentId = (req.params as { agentId?: string }).agentId;
    if (!agentId) return reply.status(401).send({ error: 'Missing agent id' });
    const headerAgentId = req.headers['x-agent-id'];
    if (headerAgentId !== agentId) return reply.status(401).send({ error: 'Agent id mismatch' });
    const token = bearerToken(req);
    if (!token) return reply.status(401).send({ error: 'Missing bearer token' });
    const valid = await getStore().verifyAgentToken(agentId, token);
    if (!valid) return reply.status(401).send({ error: 'Invalid agent token' });
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/auth/whoami', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return { agent };
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/server/info', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return {
      agent,
      channels: await store.listChannels(),
      agents: await store.listAgents(),
      version: createVersionInfo('server', {
        version: process.env.CREWDEN_VERSION,
        commit: process.env.CREWDEN_COMMIT_SHA ?? process.env.GITHUB_SHA,
        build: process.env.CREWDEN_BUILD_ID ?? process.env.GITHUB_RUN_ID,
      }),
    };
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/channels/create', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalChannelCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = (await store.listChannels()).find((channel) => channel.name === parsed.data.name);
    if (existing) return reply.status(409).send({ error: 'Channel already exists', channel: existing });
    const channel = await store.createChannel(nanoid(), parsed.data.name);
    eventBus.emit({ type: 'channel:created', channel });
    return reply.status(201).send(channel);
  });

  app.get<{ Params: { agentId: string }; Querystring: { query?: string; role?: string; capabilities?: string | string[]; excludeAgentId?: string; mustBeIdle?: boolean; maxResults?: number } }>('/internal/agent/:agentId/agents/resolve', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalAgentResolveRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    if (parsed.data.query && !parsed.data.role && (!parsed.data.capabilities || parsed.data.capabilities.length === 0)) {
      return getStore().resolveAgent(parsed.data.query);
    }
    return getStore().resolveAgentsByProfile({
      role: parsed.data.role,
      capabilities: parsed.data.capabilities,
      excludeAgentId: parsed.data.excludeAgentId,
      mustBeIdle: parsed.data.mustBeIdle,
      maxResults: parsed.data.maxResults,
    });
  });

  app.patch<{ Params: { agentId: string; targetAgentId: string } }>('/internal/agent/:agentId/agents/:targetAgentId', async (req, reply) => {
    const store = getStore();
    if (!(await store.getAgent(req.params.agentId))) return reply.status(404).send({ error: 'Agent not found' });
    const target = await store.getAgent(req.params.targetAgentId);
    if (!target) return reply.status(404).send({ error: 'Target agent not found' });
    const parsed = PatchAgentRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (
      req.params.agentId === req.params.targetAgentId &&
      (parsed.data.role !== undefined || parsed.data.capabilities !== undefined || parsed.data.permissions !== undefined)
    ) {
      return reply.status(403).send({ error: 'Agents cannot modify their own role/capabilities/permissions' });
    }
    const runtimeError = validateAgentPatch(target, parsed.data);
    if (runtimeError) return reply.status(runtimeError.statusCode).send({ error: runtimeError.error });
    const updated = await store.updateAgent(target.id, parsed.data);
    if (updated) {
      eventBus.emit({ type: 'agent:update', agent: updated });
      eventBus.emit({ type: 'agent:updated', agent: updated });
    }
    return updated;
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/messages/send', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalMessageSendRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const channel = await findChannel(parsed.data.channel);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    if (!(await canAgentWriteChannel(agent.id, channel.id))) {
      return reply.status(403).send({ error: 'Agent does not have permission: write_channels' });
    }
    let threadRootId = parsed.data.threadRootId;
    if (threadRootId) {
      const thread = await store.getThread(threadRootId);
      if (!thread) return reply.status(404).send({ error: 'Thread root not found' });
      if (thread.root.channelId !== channel.id) return reply.status(400).send({ error: 'Thread root belongs to another channel' });
      threadRootId = thread.root.id;
    }

    const message = await store.createMessage({
      id: nanoid(),
      channelId: channel.id,
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: parsed.data.content,
      threadRootId,
    });
    if (message.threadRootId) {
      const thread = await store.getThread(message.threadRootId);
      if (thread) eventBus.emit({ type: 'thread:message:new', root: thread.root, message });
    } else {
      eventBus.emit({ type: 'message:new', message });
    }
    return reply.status(201).send(message);
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/messages/check', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const channels = await store.listChannels();
    const channelSummaries = await Promise.all(channels.map(async (channel) => {
      const latest = (await store.listRecentMessages(channel.id, 1))[0];
      return { channelId: channel.id, channelName: channel.name, count: latest ? 1 : 0, latestMessage: latest };
    }));
    const dms = (await store.listDirectMessageThreads(agent.id)).map((thread) => ({
      otherAgentId: thread.otherAgentId,
      count: 1,
      latestMessage: thread.lastMessage,
    }));
    return { channels: channelSummaries, dms };
  });

  app.get<{ Params: { agentId: string }; Querystring: { channel?: string; limit?: string } }>('/internal/agent/:agentId/messages/read', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalMessageReadRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    const channel = await findChannel(parsed.data.channel);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    return getStore().listRecentMessages(channel.id, parsed.data.limit);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/dms/send', async (req, reply) => {
    const store = getStore();
    const from = await store.getAgent(req.params.agentId);
    if (!from) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalDmSendRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const target = await store.findAgentByNameOrId(parsed.data.to);
    if (!target) return reply.status(404).send({ error: 'Target agent not found' });

    const dm = await store.createDirectMessage({
      id: nanoid(),
      fromAgentId: from.id,
      toAgentId: target.id,
      content: parsed.data.content,
    });
    eventBus.emit({ type: 'dm:new', dm });
    await deliverDirectMessage(target, dm);
    return reply.status(201).send(dm);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/delegate', async (req, reply) => {
    const from = await getStore().getAgent(req.params.agentId);
    if (!from) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalAgentDelegateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const delegation = await delegateAgent({
      fromAgentId: from.id,
      toAgentId: parsed.data.to,
      content: parsed.data.content,
      startIfInactive: parsed.data.startIfInactive,
    });
    return reply.status(delegation.status === 'failed' ? 202 : 201).send(delegation);
  });

  app.get<{ Params: { agentId: string }; Querystring: { channel?: string; status?: string; all?: string } }>('/internal/agent/:agentId/tasks', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalTaskListRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    const channel = parsed.data.channel ? await findChannel(parsed.data.channel) : undefined;
    if (parsed.data.channel && !channel) return reply.status(404).send({ error: 'Channel not found' });
    const tasks = await store.listTasks({
      channelId: channel?.id,
      status: parsed.data.status,
      assigneeId: parsed.data.all ? undefined : agent.id,
    });
    return tasks;
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/tasks/create', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (!(await requireAgentPermission(agent.id, 'createTasks'))) {
      return reply.status(403).send({ error: 'Agent does not have permission: create_tasks' });
    }
    const parsed = InternalTaskCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await findChannel(parsed.data.channel);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    let normalizedMessageId = parsed.data.messageId;
    if (parsed.data.messageId) {
      const message = await store.getMessage(parsed.data.messageId);
      if (!message) return reply.status(404).send({ error: 'Source message not found' });
      if (message.channelId !== channel.id) return reply.status(400).send({ error: 'Source message belongs to another channel' });
      normalizedMessageId = message.id;
    }

    const task = await store.createTask({
      id: nanoid(),
      channelId: channel.id,
      messageId: normalizedMessageId,
      title: parsed.data.title,
      status: parsed.data.status,
      type: parsed.data.type,
      creatorName: parsed.data.creatorName,
      creator: { actorType: 'agent', actorId: agent.id },
      assigneeId: parsed.data.assigneeId,
      owner: parsed.data.assigneeId ? { actorType: 'agent', actorId: parsed.data.assigneeId } : undefined,
      isBlocked: false,
      context: parsed.data.context,
    });
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    return reply.status(201).send(task);
  });

  app.get<{ Params: { agentId: string }; Querystring: { limit?: string } }>('/internal/agent/:agentId/inbox', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalInboxRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    return buildInbox(agent, parsed.data.limit);
  });

  app.get<{ Params: { agentId: string }; Querystring: { limit?: string } }>('/internal/agent/:agentId/work', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalInboxRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    return { inbox: await buildInbox(agent, parsed.data.limit), next: 'Work assigned tasks first, claim only matching open tasks, and report blockers with task block/escalate.' };
  });

  app.get<{ Params: { agentId: string }; Querystring: { query?: string; kind?: string; tag?: string; limit?: string } }>('/internal/agent/:agentId/knowledge', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = SearchKnowledgeRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    return getStore().searchKnowledge(parsed.data);
  });

  app.get<{ Params: { agentId: string; knowledgeId: string } }>('/internal/agent/:agentId/knowledge/:knowledgeId', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const entry = await getStore().getKnowledgeEntry(req.params.knowledgeId);
    if (!entry) return reply.status(404).send({ error: 'Knowledge entry not found' });
    return entry;
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/knowledge', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (!(await requireAgentPermission(agent.id, 'createDocs'))) {
      return reply.status(403).send({ error: 'Agent does not have permission: create_docs' });
    }
    const parsed = CreateKnowledgeEntryRequestSchema.safeParse({ ...((req.body ?? {}) as object), ownerAgentId: (req.body as { ownerAgentId?: string } | undefined)?.ownerAgentId ?? agent.id });
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (parsed.data.sourceRefs.length === 0 && !parsed.data.allowNoSource) return reply.status(400).send({ error: 'sourceRefs are required unless allowNoSource is true' });
    const entry = await store.createKnowledgeEntry({
      id: nanoid(),
      kind: parsed.data.kind,
      title: parsed.data.title,
      summary: parsed.data.summary,
      body: parsed.data.body,
      tags: parsed.data.tags,
      sourceRefs: parsed.data.sourceRefs,
      ownerAgentId: parsed.data.ownerAgentId,
      reviewerAgentId: parsed.data.reviewerAgentId,
      status: parsed.data.status,
    });
    eventBus.emit({ type: 'knowledge:update', entry });
    return reply.status(201).send(entry);
  });

  app.post<{ Params: { agentId: string; goalId: string } }>('/internal/agent/:agentId/goals/:goalId/archive', async (req, reply) => {
    const agent = await getStore().getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const entry = await archiveGoal(req.params.goalId, agent.id);
    if (!entry) return reply.status(404).send({ error: 'Goal not found' });
    return reply.status(201).send(entry);
  });

  app.get<{ Params: { agentId: string }; Querystring: { channel?: string; status?: string } }>('/internal/agent/:agentId/goals', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalGoalListRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    const channel = parsed.data.channel ? await findChannel(parsed.data.channel) : undefined;
    if (parsed.data.channel && !channel) return reply.status(404).send({ error: 'Channel not found' });
    return store.listGoals({ channelId: channel?.id, status: parsed.data.status });
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/goals', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalGoalCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await findChannel(parsed.data.channel);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const goal = await store.createGoal({
      id: nanoid(),
      channelId: channel.id,
      requesterName: agent.displayName ?? agent.name,
      objective: parsed.data.objective,
      background: parsed.data.background,
      successCriteria: parsed.data.successCriteria,
      constraints: parsed.data.constraints,
      assumptions: parsed.data.assumptions,
      risks: parsed.data.risks,
      status: 'draft',
    });
    eventBus.emit({ type: 'goal:update', goal });
    return reply.status(201).send(goal);
  });

  app.get<{ Params: { agentId: string; goalId: string } }>('/internal/agent/:agentId/goals/:goalId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const goal = await store.getGoal(req.params.goalId);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    const tasks = (await store.listTasks({ channelId: goal.channelId })).filter((task) => task.context?.goalId === goal.id);
    return { goal, tasks };
  });

  app.post<{ Params: { agentId: string; goalId: string } }>('/internal/agent/:agentId/goals/:goalId/tasks', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const goal = await store.getGoal(req.params.goalId);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    const parsed = InternalGoalCreateTasksRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const tasks = [];
    for (const draft of parsed.data.tasks) {
      const task = await store.createTask({
        id: nanoid(),
        channelId: goal.channelId,
        messageId: goal.sourceMessageId,
        title: draft.title,
        status: 'backlog',
        creatorName: parsed.data.creatorName,
        creator: { actorType: 'agent', actorId: agent.id },
        assigneeId: draft.assigneeId,
        owner: draft.assigneeId ? { actorType: 'agent', actorId: draft.assigneeId } : undefined,
        type: 'feature',
        acceptanceCriteria: draft.acceptanceCriteria.length > 0 ? draft.acceptanceCriteria : goal.successCriteria,
        dependsOn: draft.dependencies,
        isBlocked: false,
        sourceChannelId: goal.channelId,
        context: {
          goalId: goal.id,
          goalObjective: goal.objective,
          goal: goal.objective,
          background: goal.background.join('\n'),
          acceptanceCriteria: draft.acceptanceCriteria.length > 0 ? draft.acceptanceCriteria : goal.successCriteria,
          constraints: goal.constraints,
          assumptions: goal.assumptions,
          risks: goal.risks,
          dependencies: draft.dependencies,
          artifacts: draft.artifacts,
          sourceMessageIds: goal.sourceMessageId ? [goal.sourceMessageId] : undefined,
        },
      });
      eventBus.emit({ type: 'task:update', task });
      await notifyTaskAssignee(task);
      tasks.push(task);
    }
    return reply.status(201).send({ tasks });
  });

  app.post<{ Params: { agentId: string }; Querystring: { messageId?: string } }>('/internal/agent/:agentId/goals/align', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (!req.query.messageId) return reply.status(400).send({ error: 'Missing messageId' });
    const parsed = InternalGoalAlignRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const message = await store.getMessage(req.query.messageId);
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const objective = parsed.data.objective ?? message.content.slice(0, 240);
    const recommendation = recommendAgentsForGoal(objective, await store.listAgents());
    const questions = buildClarifyingQuestions(message);
    const riskLevel = inferGoalRiskLevel(message);
    const alignment = await store.createGoalAlignment({
      id: nanoid(),
      channelId: message.channelId,
      threadRootId: message.threadRootId ?? message.id,
      sourceMessageId: message.id,
      status: questions.length > 0 || riskLevel !== 'low' ? 'needs_clarification' : 'awaiting_confirmation',
      objective,
      questions,
      answers: [],
      successCriteria: ['A confirmed plan exists with clear task owners and acceptance criteria.'],
      constraints: riskLevel === 'high' ? ['Wait for explicit user confirmation before execution.'] : [],
      planSummary: buildPlanSummary(objective, recommendation, riskLevel),
      taskDrafts: buildTaskDrafts(objective, recommendation),
      recommendedAgentIds: recommendation.ownerAgentIds,
      reviewerAgentIds: recommendation.reviewerAgentIds,
      recommendationReasons: recommendation.reasons,
      gaps: recommendation.gaps,
      riskLevel,
    });
    eventBus.emit({ type: 'goal-alignment:update', alignment });
    await store.createMessage({
      id: nanoid(),
      channelId: alignment.channelId,
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: [
        `Goal alignment started: ${alignment.objective}`,
        alignment.planSummary,
        alignment.questions.length > 0 ? `Clarifying questions:\n${alignment.questions.map((question) => `- ${question}`).join('\n')}` : 'Plan is ready for confirmation.',
      ].filter(Boolean).join('\n\n'),
      threadRootId: alignment.threadRootId,
    });
    return reply.status(201).send(alignment);
  });

  app.get<{ Params: { agentId: string; alignmentId: string } }>('/internal/agent/:agentId/goal-alignments/:alignmentId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const alignment = await store.getGoalAlignment(req.params.alignmentId);
    if (!alignment) return reply.status(404).send({ error: 'Goal alignment not found' });
    return alignment;
  });

  app.post<{ Params: { agentId: string; alignmentId: string } }>('/internal/agent/:agentId/goal-alignments/:alignmentId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalGoalAlignmentPatchRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const alignment = await store.updateGoalAlignment(req.params.alignmentId, parsed.data);
    if (!alignment) return reply.status(404).send({ error: 'Goal alignment not found' });
    eventBus.emit({ type: 'goal-alignment:update', alignment });
    return alignment;
  });

  app.post<{ Params: { agentId: string; alignmentId: string } }>('/internal/agent/:agentId/goal-alignments/:alignmentId/confirm', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = ConfirmGoalAlignmentRequestSchema.safeParse({ requesterName: agent.displayName ?? agent.name });
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const alignment = await store.getGoalAlignment(req.params.alignmentId);
    if (!alignment) return reply.status(404).send({ error: 'Goal alignment not found' });
    if (alignment.status === 'cancelled') return reply.status(409).send({ error: 'Goal alignment is cancelled' });
    const goal = alignment.goalId
      ? await store.updateGoal(alignment.goalId, {
          objective: alignment.objective,
          successCriteria: alignment.successCriteria,
          constraints: alignment.constraints,
          status: 'confirmed',
        })
      : await store.createGoal({
          id: nanoid(),
          channelId: alignment.channelId,
          sourceMessageId: alignment.sourceMessageId,
          requesterName: parsed.data.requesterName,
          objective: alignment.objective,
          background: alignment.answers,
          successCriteria: alignment.successCriteria,
          constraints: alignment.constraints,
          assumptions: alignment.gaps,
          risks: alignment.riskLevel === 'low' ? [] : [`${alignment.riskLevel} risk plan; keep user confirmation explicit.`],
          status: 'confirmed',
        });
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    eventBus.emit({ type: 'goal:update', goal });
    const tasks = [];
    for (const draft of alignment.taskDrafts) {
      const task = await store.createTask({
        id: nanoid(),
        channelId: alignment.channelId,
        messageId: alignment.sourceMessageId,
        title: draft.title,
        status: 'backlog',
        creatorName: parsed.data.requesterName,
        creator: { actorType: 'agent', actorId: agent.id },
        assigneeId: draft.assigneeId,
        owner: draft.assigneeId ? { actorType: 'agent', actorId: draft.assigneeId } : undefined,
        type: 'feature',
        acceptanceCriteria: (draft.acceptanceCriteria?.length ?? 0) > 0 ? draft.acceptanceCriteria : alignment.successCriteria,
        constraints: alignment.constraints,
        dependsOn: draft.dependencies,
        isBlocked: false,
        sourceChannelId: alignment.channelId,
        sourceThreadId: alignment.threadRootId,
        context: {
          goalId: goal.id,
          goalObjective: goal.objective,
          goal: goal.objective,
          background: alignment.planSummary,
          acceptanceCriteria: (draft.acceptanceCriteria?.length ?? 0) > 0 ? draft.acceptanceCriteria : alignment.successCriteria,
          constraints: alignment.constraints,
          assumptions: alignment.gaps,
          dependencies: draft.dependencies,
          artifacts: draft.artifacts,
          sourceMessageIds: [alignment.sourceMessageId],
        },
      });
      eventBus.emit({ type: 'task:update', task });
      await notifyTaskAssignee(task);
      tasks.push(task);
    }
    const updated = await store.updateGoalAlignment(alignment.id, { status: 'confirmed', goalId: goal.id });
    if (updated) eventBus.emit({ type: 'goal-alignment:update', alignment: updated });
    return reply.status(201).send({ alignment: updated ?? alignment, goal, tasks });
  });

  app.get<{ Params: { agentId: string }; Querystring: { all?: string } }>('/internal/agent/:agentId/reviews', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = InternalReviewListRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    const reviews = (await store.listTasks()).flatMap((task) => (task.context?.reviews ?? []).map((review) => ({ ...review, task })));
    return reviews.filter((review) => parsed.data.all || review.reviewerAgentId === agent.id);
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/reviews', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const task = await store.getTask(req.params.taskId);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    const parsed = CreateTaskReviewRequestSchema.safeParse({ ...((req.body ?? {}) as object), requesterAgentId: agent.id });
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (isHighRiskReviewTask(task) && parsed.data.reviewerAgentId === agent.id && !parsed.data.allowSelfReview) {
      return reply.status(400).send({ error: 'High risk task requires a different reviewer' });
    }
    if (!isTaskTransitionAllowed(task.status, 'in_review')) {
      return reply.status(422).send({ error: 'Invalid task status transition', from: task.status, to: 'in_review' });
    }
    const review = createTaskReview(task.id, parsed.data);
    const updated = await store.updateTask(task.id, {
      status: 'in_review',
      context: {
        ...task.context,
        reviewerAgentId: parsed.data.reviewerAgentId,
        evidence: review.evidence,
        acceptanceChecklist: review.checklist.map((item) => item.label),
        reviewIds: [...(task.context?.reviewIds ?? []), review.id],
        reviewNotes: [...(task.context?.reviewNotes ?? []), parsed.data.selfReviewReason ? `self-review allowed: ${parsed.data.selfReviewReason}` : parsed.data.comment ?? 'review requested'],
        reviews: [...(task.context?.reviews ?? []), review],
      },
    });
    if (!updated) return reply.status(404).send({ error: 'Task not found' });
    if (updated.status !== task.status) {
      await store.appendAuditLog({
        actorType: 'agent',
        actorId: agent.id,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: updated.id,
        taskId: updated.id,
        agentId: agent.id,
        detailJson: { from: task.status, to: updated.status, reason: 'review_requested' },
      });
    }
    eventBus.emit({ type: 'task:update', task: updated });
    return reply.status(201).send(review);
  });

  app.post<{ Params: { agentId: string; reviewId: string } }>('/internal/agent/:agentId/reviews/:reviewId/approve', async (req, reply) => {
    return internalReviewDecision(req.params.agentId, req.params.reviewId, req.body, 'approved', reply);
  });

  app.post<{ Params: { agentId: string; reviewId: string } }>('/internal/agent/:agentId/reviews/:reviewId/request-changes', async (req, reply) => {
    return internalReviewDecision(req.params.agentId, req.params.reviewId, req.body, 'changes_requested', reply);
  });

  app.get<{ Params: { agentId: string } }>('/internal/agent/:agentId/reminders', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return store.listReminders(agent.id);
  });

  app.post<{ Params: { agentId: string } }>('/internal/agent/:agentId/reminders', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = CreateReminderRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await findChannel(parsed.data.channelId);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const reminder = await store.createReminder({
      id: nanoid(),
      agentId: agent.id,
      channelId: channel.id,
      message: parsed.data.message,
      triggerAt: parsed.data.triggerAt,
      status: 'pending',
    });
    eventBus.emit({ type: 'reminder:update', reminder });
    return reply.status(201).send(reminder);
  });

  app.post<{ Params: { agentId: string; reminderId: string } }>('/internal/agent/:agentId/reminders/:reminderId/cancel', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const parsed = PatchReminderRequestSchema.safeParse({ status: 'cancelled' });
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = await store.getReminder(req.params.reminderId);
    if (!existing || existing.agentId !== agent.id) return reply.status(404).send({ error: 'Reminder not found' });
    const reminder = await store.updateReminder(existing.id, { status: parsed.data.status });
    if (reminder) eventBus.emit({ type: 'reminder:update', reminder });
    return reminder;
  });

  app.get<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const task = await store.getTask(req.params.taskId);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.assigneeId && task.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/claim', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (!(await requireAgentPermission(agent.id, 'claimTasks'))) {
      return reply.status(403).send({ error: 'Agent does not have permission: claim_tasks' });
    }
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (existing.assigneeId && existing.assigneeId !== agent.id) return reply.status(409).send({ error: 'Task is assigned to another agent' });
    const shouldAcknowledge = !existing.assigneeId;
    const task = await store.updateTask(existing.id, {
      assigneeId: agent.id,
      owner: { actorType: 'agent', actorId: agent.id },
      status: existing.status === 'backlog' || existing.status === 'ready' ? 'assigned' : existing.status,
      context: appendProgress(existing, agent.id, 'claimed', `Claimed by ${agent.displayName ?? agent.name}`),
    });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.status !== existing.status) {
      await store.appendAuditLog({
        actorType: 'agent',
        actorId: agent.id,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: task.id,
        taskId: task.id,
        agentId: agent.id,
        detailJson: { from: existing.status, to: task.status, reason: 'claim' },
      });
    }
    eventBus.emit({ type: 'task:update', task });
    if (shouldAcknowledge) await createTaskClaimAcknowledgement(task, agent);
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/progress', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (existing.assigneeId && existing.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    const parsed = InternalTaskProgressRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const task = await store.updateTask(existing.id, { context: appendProgress(existing, agent.id, 'heartbeat', parsed.data.detail) });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    eventBus.emit({ type: 'task:update', task });
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/block', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (existing.assigneeId && existing.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    const parsed = InternalTaskBlockRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const context = appendProgress(existing, agent.id, 'blocked', `${parsed.data.reason}; needs: ${parsed.data.needs}`);
    const task = await store.updateTask(existing.id, {
      isBlocked: true,
      blockedReason: parsed.data.reason,
      context: { ...context, blockedReason: parsed.data.reason, blockedNeeds: parsed.data.needs },
    });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.status !== existing.status) {
      await store.appendAuditLog({
        actorType: 'agent',
        actorId: agent.id,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: task.id,
        taskId: task.id,
        agentId: agent.id,
        detailJson: { from: existing.status, to: task.status, reason: 'block' },
      });
    }
    await store.appendAuditLog({
      actorType: 'agent',
      actorId: agent.id,
      action: 'task.blocked',
      entityType: 'task',
      entityId: task.id,
      taskId: task.id,
      agentId: agent.id,
      detailJson: { reason: parsed.data.reason, needs: parsed.data.needs },
    });
    eventBus.emit({ type: 'task:update', task });
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/escalate', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    const parsed = InternalTaskEscalateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const context = appendProgress(existing, agent.id, 'escalated', parsed.data.reason);
    const task = await store.updateTask(existing.id, { context: { ...context, escalatedReason: parsed.data.reason } });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    eventBus.emit({ type: 'task:update', task });
    const message = await store.createMessage({
      id: nanoid(),
      channelId: existing.channelId,
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: `Escalation for task "${existing.title}": ${parsed.data.reason}`,
      threadRootId: existing.messageId,
    });
    eventBus.emit(message.threadRootId ? { type: 'thread:message:new', root: (await store.getThread(message.threadRootId))!.root, message } : { type: 'message:new', message });
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/update', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (existing.assigneeId && existing.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    const parsed = InternalTaskUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (parsed.data.status && !isTaskTransitionAllowed(existing.status, parsed.data.status)) {
      return reply.status(422).send({ error: 'Invalid task status transition', from: existing.status, to: parsed.data.status });
    }
    const dependencyError = await validateTaskDependencies(existing.id, parsed.data.context?.blockedByTaskIds);
    if (dependencyError) return reply.status(422).send({ error: dependencyError });
    if (parsed.data.status === 'in_progress') {
      const blockersError = await validateBlockersComplete({ ...existing, ...parsed.data });
      if (blockersError) return reply.status(422).send({ error: blockersError });
    }
    const task = await store.updateTask(req.params.taskId, parsed.data);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (parsed.data.status && parsed.data.status !== existing.status) {
      await store.appendAuditLog({
        actorType: 'agent',
        actorId: agent.id,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: task.id,
        taskId: task.id,
        agentId: agent.id,
        detailJson: { from: existing.status, to: task.status },
      });
    }
    eventBus.emit({ type: 'task:update', task });
    return task;
  });

  app.post<{ Params: { agentId: string; taskId: string } }>('/internal/agent/:agentId/tasks/:taskId/handoff', async (req, reply) => {
    const store = getStore();
    const agent = await store.getAgent(req.params.agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    const existing = await store.getTask(req.params.taskId);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (existing.assigneeId && existing.assigneeId !== agent.id) return reply.status(403).send({ error: 'Task is assigned to another agent' });
    const parsed = InternalTaskHandoffRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const target = await store.findAgentByNameOrId(parsed.data.to);
    if (!target) return reply.status(404).send({ error: 'Target agent not found' });
    const nextNote = [
      `from ${agent.displayName ?? agent.name}: ${parsed.data.notes}`,
      parsed.data.nextStep ? `next: ${parsed.data.nextStep}` : undefined,
    ].filter(Boolean).join('\n');
    const task = await store.updateTask(existing.id, {
      assigneeId: target.id,
      context: {
        ...existing.context,
        goal: parsed.data.goal ?? existing.context?.goal,
        previousAgentId: agent.id,
        handoffNotes: [...(existing.context?.handoffNotes ?? []), nextNote],
      },
    });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    await store.appendAuditLog({
      actorType: 'agent',
      actorId: agent.id,
      action: 'task.handoff',
      entityType: 'task',
      entityId: task.id,
      taskId: task.id,
      agentId: agent.id,
      detailJson: {
        fromAgentId: agent.id,
        toAgentId: target.id,
        previousAssigneeId: existing.assigneeId,
        noteCount: task.context?.handoffNotes?.length ?? 0,
      },
    });
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    return task;
  });
}

function bearerToken(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  const match = typeof auth === 'string' ? auth.match(/^Bearer\s+(.+)$/i) : undefined;
  return match?.[1];
}

async function findChannel(value: string) {
  const store = getStore();
  const byId = await store.getChannel(value);
  if (byId) return byId;
  return (await store.listChannels()).find((channel) => channel.name === value);
}

function buildTaskDrafts(objective: string, recommendation: ReturnType<typeof recommendAgentsForGoal>): GoalAlignment['taskDrafts'] {
  const owner = recommendation.ownerAgentIds[0];
  const reviewer = recommendation.reviewerAgentIds[0];
  return [
    {
      title: `Plan: ${objective}`.slice(0, 200),
      assigneeId: owner,
      role: 'owner',
      acceptanceCriteria: ['Scope, milestones, and handoff points are clear.'],
    },
    {
      title: `Review acceptance for: ${objective}`.slice(0, 200),
      assigneeId: reviewer,
      role: 'reviewer',
      dependencies: owner ? [`Owner plan from ${owner}`] : [],
      acceptanceCriteria: ['Review notes and acceptance risks are documented.'],
    },
  ];
}

function buildPlanSummary(objective: string, recommendation: ReturnType<typeof recommendAgentsForGoal>, riskLevel: GoalAlignment['riskLevel']): string {
  const owners = recommendation.ownerAgentIds.length > 0 ? recommendation.ownerAgentIds.join(', ') : 'No owner match';
  const reviewers = recommendation.reviewerAgentIds.length > 0 ? recommendation.reviewerAgentIds.join(', ') : 'No reviewer match';
  return `Draft plan for "${objective}". Owners: ${owners}. Reviewers: ${reviewers}. Risk: ${riskLevel}.`;
}

async function internalReviewDecision(agentId: string, reviewId: string, body: unknown, status: 'approved' | 'changes_requested', reply: any) {
  const store = getStore();
  const agent = await store.getAgent(agentId);
  if (!agent) return reply.status(404).send({ error: 'Agent not found' });
  const parsed = ReviewDecisionRequestSchema.safeParse({ ...((body ?? {}) as object), reviewerAgentId: agent.id });
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
  const task = (await store.listTasks()).find((candidate) => candidate.context?.reviews?.some((review) => review.id === reviewId));
  if (!task) return reply.status(404).send({ error: 'Review not found' });
  const review = task.context?.reviews?.find((candidate) => candidate.id === reviewId);
  if (review?.reviewerAgentId && review.reviewerAgentId !== agent.id) return reply.status(403).send({ error: 'Review is assigned to another agent' });
  const nextTaskStatus = status === 'approved' ? 'done' : 'changes_requested';
  if (!isTaskTransitionAllowed(task.status, nextTaskStatus)) {
    return reply.status(422).send({ error: 'Invalid task status transition', from: task.status, to: nextTaskStatus });
  }
  const now = new Date().toISOString();
  const reviews = (task.context?.reviews ?? []).map((candidate) => candidate.id === reviewId
    ? {
      ...candidate,
      reviewerAgentId: parsed.data.reviewerAgentId ?? candidate.reviewerAgentId,
      status,
      comment: parsed.data.comment,
      checklist: candidate.checklist.map((item) => ({ ...item, checked: status === 'approved' ? true : item.checked })),
      updatedAt: now,
    }
    : candidate);
  const updated = await store.updateTask(task.id, {
    status: nextTaskStatus,
    context: {
      ...task.context,
      reviewNotes: [...(task.context?.reviewNotes ?? []), `${status}: ${parsed.data.comment}`],
      reviews,
    },
  });
  if (!updated) return reply.status(404).send({ error: 'Task not found' });
  if (updated.status !== task.status) {
    await store.appendAuditLog({
      actorType: 'agent',
      actorId: agent.id,
      action: 'task.status_changed',
      entityType: 'task',
      entityId: updated.id,
      taskId: updated.id,
      agentId: agent.id,
      detailJson: { from: task.status, to: updated.status, reason: status },
    });
  }
  eventBus.emit({ type: 'task:update', task: updated });
  return reply.status(200).send(reviews.find((candidate) => candidate.id === reviewId));
}

function isTaskTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    backlog: ['spec_needed', 'ready', 'cancelled'],
    spec_needed: ['ready', 'backlog'],
    ready: ['assigned', 'backlog', 'cancelled'],
    assigned: ['in_progress', 'ready', 'cancelled'],
    in_progress: ['in_review', 'cancelled'],
    in_review: ['changes_requested', 'qa', 'done', 'cancelled'],
    changes_requested: ['in_progress', 'cancelled'],
    qa: ['done', 'changes_requested', 'cancelled'],
    done: [],
    cancelled: [],
  };
  return allowed[from].includes(to);
}

async function validateTaskDependencies(taskId: string, blockedByTaskIds: string[] | undefined): Promise<string | undefined> {
  if (!blockedByTaskIds?.length) return undefined;
  if (blockedByTaskIds.includes(taskId)) return 'Circular task dependency';
  const store = getStore();
  for (const blockerId of blockedByTaskIds) {
    const blocker = await store.getTask(blockerId);
    if (!blocker) return 'Unknown task dependency';
    if (await hasDependencyPath(blockerId, taskId, new Set([taskId]))) return 'Circular task dependency';
  }
  return undefined;
}

async function validateBlockersComplete(task: { dependsOn?: string[]; context?: { blockedByTaskIds?: string[] } }): Promise<string | undefined> {
  const blockerIds = [...new Set([...(task.dependsOn ?? []), ...(task.context?.blockedByTaskIds ?? [])])];
  for (const blockerId of blockerIds) {
    const blocker = await getStore().getTask(blockerId);
    if (!blocker) return 'Unknown task dependency';
    if (blocker.status !== 'done') return 'Task dependency is not done';
  }
  return undefined;
}

async function hasDependencyPath(fromTaskId: string, targetTaskId: string, visited: Set<string>): Promise<boolean> {
  if (fromTaskId === targetTaskId) return true;
  if (visited.has(fromTaskId)) return false;
  visited.add(fromTaskId);
  const task = await getStore().getTask(fromTaskId);
  for (const blockerId of task?.context?.blockedByTaskIds ?? []) {
    if (await hasDependencyPath(blockerId, targetTaskId, visited)) return true;
  }
  return false;
}

function createTaskReview(taskId: string, data: { requesterAgentId?: string; reviewerAgentId?: string; evidence: string[]; checklist: Array<string | { label: string; checked: boolean }>; comment?: string }): TaskReview {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    taskId,
    requesterAgentId: data.requesterAgentId,
    reviewerAgentId: data.reviewerAgentId,
    status: 'requested',
    evidence: data.evidence,
    checklist: data.checklist.map((item) => typeof item === 'string' ? { label: item, checked: false } : item),
    comment: data.comment,
    createdAt: now,
    updatedAt: now,
  };
}

function isHighRiskReviewTask(task: { context?: { risks?: string[] } }): boolean {
  return (task.context?.risks ?? []).some((risk) => /high|production|payment|legal|privacy|credential|高风险|上线|支付|隐私/.test(risk.toLowerCase()));
}

async function buildInbox(agent: Agent, limit: number): Promise<AgentInboxItem[]> {
  const store = getStore();
  const tasks = await store.listTasks();
  const reminders = await store.listReminders(agent.id);
  const dms = await store.listDirectMessageThreads(agent.id);
  const items: AgentInboxItem[] = [];
  for (const task of tasks) {
    if (task.status === 'done') continue;
    for (const review of task.context?.reviews ?? []) {
      if (review.status === 'requested' && review.reviewerAgentId === agent.id) {
        items.push({
          id: `review_request:${review.id}`,
          kind: 'review_request',
          agentId: agent.id,
          channelId: task.channelId,
          messageId: task.messageId,
          taskId: task.id,
          goalId: task.context?.goalId,
          priority: task.context?.risks?.some((risk) => /high|production|payment|legal|privacy|credential|高风险|上线|支付|隐私/.test(risk.toLowerCase())) ? 'high' : 'normal',
          summary: `Review requested: ${task.title}`,
          createdAt: review.createdAt,
        });
      }
    }
    if (task.assigneeId === agent.id) {
      items.push({
        id: `assigned_task:${task.id}`,
        kind: task.context?.blockedReason ? 'blocked_escalation' : 'assigned_task',
        agentId: agent.id,
        channelId: task.channelId,
        messageId: task.messageId,
        taskId: task.id,
        goalId: task.context?.goalId,
        priority: task.context?.blockedReason ? 'high' : 'normal',
        summary: task.context?.blockedReason ? `Blocked task: ${task.title} (${task.context.blockedReason})` : `Assigned task: ${task.title}`,
        createdAt: task.updatedAt,
      });
    } else if (!task.assigneeId && matchesAgentCapability(agent, task)) {
      items.push({
        id: `claimable_task:${task.id}`,
        kind: 'claimable_task',
        agentId: agent.id,
        channelId: task.channelId,
        messageId: task.messageId,
        taskId: task.id,
        goalId: task.context?.goalId,
        priority: 'normal',
        summary: `Claimable task matching your role/capability: ${task.title}`,
        createdAt: task.createdAt,
      });
    }
  }
  for (const reminder of reminders.filter((reminder) => reminder.status === 'pending')) {
    items.push({
      id: `reminder:${reminder.id}`,
      kind: 'reminder',
      agentId: agent.id,
      channelId: reminder.channelId,
      priority: 'normal',
      summary: `Reminder: ${reminder.message}`,
      dueAt: reminder.triggerAt,
      createdAt: reminder.createdAt,
    });
  }
  for (const thread of dms.slice(0, 10)) {
    items.push({
      id: `dm:${thread.lastMessage.id}`,
      kind: 'dm',
      agentId: agent.id,
      priority: 'normal',
      summary: `DM from ${thread.otherAgentId}: ${thread.lastMessage.content.slice(0, 120)}`,
      createdAt: thread.lastMessage.createdAt,
    });
  }
  return items.sort(compareInboxItems).slice(0, limit);
}

function compareInboxItems(a: AgentInboxItem, b: AgentInboxItem): number {
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
  return rank[a.priority] - rank[b.priority] || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function appendProgress(task: Task, agentId: string, type: TaskProgressEventType, detail: string): Task['context'] {
  const event = {
    id: nanoid(),
    taskId: task.id,
    agentId,
    type,
    detail,
    createdAt: new Date().toISOString(),
  };
  return {
    ...task.context,
    claimedByAgentId: type === 'claimed' ? agentId : task.context?.claimedByAgentId,
    progressEvents: [...(task.context?.progressEvents ?? []), event].slice(-20),
  };
}

async function createTaskClaimAcknowledgement(task: Task, agent: Agent): Promise<void> {
  const store = getStore();
  const message = await store.createMessage({
    id: nanoid(),
    channelId: task.channelId,
    senderName: agent.displayName ?? agent.name,
    agentId: agent.id,
    content: `@user I have claimed task #${task.id} "${task.title}" and I am starting now. I will post progress or blockers here.`,
    threadRootId: task.messageId,
    mentions: [{ type: 'user', id: 'user', label: 'user' }],
  });
  if (message.threadRootId) {
    const thread = await store.getThread(message.threadRootId);
    if (thread) eventBus.emit({ type: 'thread:message:new', root: thread.root, message });
  } else {
    eventBus.emit({ type: 'message:new', message });
  }
}

async function deliverDirectMessage(target: Agent, dm: DirectMessage): Promise<void> {
  await deliverToAgent({
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
  });
}
