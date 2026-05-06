import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import {
  CreateGoalBriefRequestSchema,
  CreateGoalTasksRequestSchema,
  GoalBriefStatusSchema,
  MessageToGoalBriefRequestSchema,
  PatchGoalBriefRequestSchema,
} from '@crewden/shared';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { notifyTaskAssignee } from '../taskDelivery.js';

export async function goalRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { projectId?: string; channelId?: string; status?: string } }>('/api/goals', async (req, reply) => {
    const status = req.query.status === undefined ? undefined : GoalBriefStatusSchema.safeParse(req.query.status);
    if (status && !status.success) return reply.status(400).send({ error: 'Invalid status' });
    return getStore().listGoals({
      projectId: req.query.projectId,
      channelId: req.query.channelId,
      status: status?.success ? status.data : undefined,
    });
  });

  app.post('/api/goals', async (req, reply) => {
    const parsed = CreateGoalBriefRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const channel = await getStore().getChannel(parsed.data.channelId, { projectId: parsed.data.projectId });
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    if (parsed.data.sourceMessageId) {
      const message = await getStore().getMessage(parsed.data.sourceMessageId);
      if (!message) return reply.status(404).send({ error: 'Source message not found' });
      if (message.channelId !== channel.id) return reply.status(400).send({ error: 'Source message belongs to another channel' });
    }

    const goal = await getStore().createGoal({
      id: nanoid(),
      projectId: channel.projectId,
      channelId: channel.id,
      sourceMessageId: parsed.data.sourceMessageId,
      requesterName: parsed.data.requesterName,
      objective: parsed.data.objective,
      background: parsed.data.background,
      successCriteria: parsed.data.successCriteria,
      constraints: parsed.data.constraints,
      assumptions: parsed.data.assumptions,
      risks: parsed.data.risks,
      status: parsed.data.status,
    });
    eventBus.emit({ type: 'goal:update', goal });
    return reply.status(201).send(goal);
  });

  app.get<{ Params: { id: string } }>('/api/goals/:id', async (req, reply) => {
    const goal = await getStore().getGoal(req.params.id);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    const tasks = await getStore().listTasks({ projectId: goal.projectId, channelId: goal.channelId });
    return { goal, tasks: tasks.filter((task) => task.context?.goalId === goal.id) };
  });

  app.patch<{ Params: { id: string } }>('/api/goals/:id', async (req, reply) => {
    const parsed = PatchGoalBriefRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const goal = await getStore().updateGoal(req.params.id, parsed.data);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    eventBus.emit({ type: 'goal:update', goal });
    return goal;
  });

  app.post<{ Params: { id: string } }>('/api/goals/:id/tasks', async (req, reply) => {
    const goal = await getStore().getGoal(req.params.id);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    const parsed = CreateGoalTasksRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const tasks = [];
    for (const draft of parsed.data.tasks) {
      const task = await getStore().createTask({
        id: nanoid(),
        projectId: goal.projectId,
        channelId: goal.channelId,
        messageId: goal.sourceMessageId,
        title: draft.title,
        status: 'backlog',
        type: 'feature',
        creatorName: parsed.data.creatorName,
        creator: { actorType: 'human', actorId: parsed.data.creatorName },
        assigneeId: draft.assigneeId,
        owner: draft.assigneeId ? { actorType: 'agent', actorId: draft.assigneeId } : undefined,
        acceptanceCriteria: draft.acceptanceCriteria.length > 0 ? draft.acceptanceCriteria : goal.successCriteria,
        constraints: goal.constraints,
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

  app.post<{ Params: { id: string } }>('/api/messages/:id/to-goal', async (req, reply) => {
    const store = getStore();
    const message = await store.getMessage(req.params.id);
    if (!message) return reply.status(404).send({ error: 'Message not found' });
    const parsed = MessageToGoalBriefRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const goal = await store.createGoal({
      id: nanoid(),
      projectId: message.projectId,
      channelId: message.channelId,
      sourceMessageId: message.id,
      requesterName: parsed.data.requesterName,
      objective: parsed.data.objective ?? message.content.slice(0, 240),
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
}
