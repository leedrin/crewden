import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import {
  ConfirmGoalAlignmentRequestSchema,
  GoalAlignmentStatusSchema,
  PatchGoalAlignmentRequestSchema,
  StartGoalAlignmentRequestSchema,
  type GoalAlignment,
} from '@crewden/shared';
import { buildClarifyingQuestions, inferGoalRiskLevel, recommendAgentsForGoal } from '@crewden/hub-core';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { notifyTaskAssignee } from '../taskDelivery.js';

export async function goalAlignmentRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { projectId?: string; channelId?: string; status?: string } }>('/api/goal-alignments', async (req, reply) => {
    const status = req.query.status === undefined ? undefined : GoalAlignmentStatusSchema.safeParse(req.query.status);
    if (status && !status.success) return reply.status(400).send({ error: 'Invalid status' });
    return getStore().listGoalAlignments({
      projectId: req.query.projectId,
      channelId: req.query.channelId,
      status: status?.success ? status.data : undefined,
    });
  });

  app.post<{ Params: { id: string } }>('/api/messages/:id/start-goal-alignment', async (req, reply) => {
    const parsed = StartGoalAlignmentRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const store = getStore();
    const message = await store.getMessage(req.params.id);
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const agents = await store.listAgents({ projectId: message.projectId });
    const objective = parsed.data.objective ?? message.content.slice(0, 240);
    const recommendation = recommendAgentsForGoal(objective, agents);
    const questions = buildClarifyingQuestions(message);
    const riskLevel = inferGoalRiskLevel(message);
    const taskDrafts = buildTaskDrafts(objective, recommendation);
    const alignment = await store.createGoalAlignment({
      id: nanoid(),
      projectId: message.projectId,
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
      taskDrafts,
      recommendedAgentIds: recommendation.ownerAgentIds,
      reviewerAgentIds: recommendation.reviewerAgentIds,
      recommendationReasons: recommendation.reasons,
      gaps: recommendation.gaps,
      riskLevel,
    });
    eventBus.emit({ type: 'goal-alignment:update', alignment });
    await postAlignmentThreadMessage(alignment, parsed.data.requesterName);
    return reply.status(201).send(alignment);
  });

  app.get<{ Params: { id: string } }>('/api/goal-alignments/:id', async (req, reply) => {
    const alignment = await getStore().getGoalAlignment(req.params.id);
    if (!alignment) return reply.status(404).send({ error: 'Goal alignment not found' });
    return alignment;
  });

  app.patch<{ Params: { id: string } }>('/api/goal-alignments/:id', async (req, reply) => {
    const parsed = PatchGoalAlignmentRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const alignment = await getStore().updateGoalAlignment(req.params.id, parsed.data);
    if (!alignment) return reply.status(404).send({ error: 'Goal alignment not found' });
    eventBus.emit({ type: 'goal-alignment:update', alignment });
    return alignment;
  });

  app.post<{ Params: { id: string } }>('/api/goal-alignments/:id/cancel', async (req, reply) => {
    const alignment = await getStore().updateGoalAlignment(req.params.id, { status: 'cancelled' });
    if (!alignment) return reply.status(404).send({ error: 'Goal alignment not found' });
    eventBus.emit({ type: 'goal-alignment:update', alignment });
    return alignment;
  });

  app.post<{ Params: { id: string } }>('/api/goal-alignments/:id/confirm', async (req, reply) => {
    const parsed = ConfirmGoalAlignmentRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const store = getStore();
    const alignment = await store.getGoalAlignment(req.params.id);
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
          projectId: alignment.projectId,
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
        projectId: alignment.projectId,
        channelId: alignment.channelId,
        messageId: alignment.sourceMessageId,
        title: draft.title,
        status: 'backlog',
        type: 'feature',
        creatorName: parsed.data.requesterName,
        creator: { actorType: 'human', actorId: parsed.data.requesterName },
        assigneeId: draft.assigneeId,
        owner: draft.assigneeId ? { actorType: 'agent', actorId: draft.assigneeId } : undefined,
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
    await store.createMessage({
      id: nanoid(),
      projectId: alignment.projectId,
      channelId: alignment.channelId,
      senderName: 'system',
      content: `Goal plan confirmed: ${goal.objective}\nTasks created: ${tasks.map((task) => `#${task.id.slice(0, 6)} ${task.title}`).join('; ')}`,
      threadRootId: alignment.threadRootId,
    });
    return reply.status(201).send({ alignment: updated ?? alignment, goal, tasks });
  });
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

async function postAlignmentThreadMessage(alignment: GoalAlignment, requesterName: string): Promise<void> {
  await getStore().createMessage({
    id: nanoid(),
    projectId: alignment.projectId,
    channelId: alignment.channelId,
    senderName: 'system',
    content: [
      `Goal alignment started by ${requesterName}: ${alignment.objective}`,
      alignment.planSummary,
      alignment.questions.length > 0 ? `Clarifying questions:\n${alignment.questions.map((question) => `- ${question}`).join('\n')}` : 'Plan is ready for confirmation.',
    ].filter(Boolean).join('\n\n'),
    threadRootId: alignment.threadRootId,
  });
}
