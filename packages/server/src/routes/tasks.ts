import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { CreateTaskRequestSchema, CreateTaskReviewRequestSchema, MessageToTaskRequestSchema, PatchTaskRequestSchema, ReviewDecisionRequestSchema, TaskStatusSchema, type ActorType, type TaskReview, type TaskStatus } from '@crewden/shared';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { notifyTaskAssignee, notifyTasksBlockedBy } from '../taskDelivery.js';
import { requireAgentPermission } from '../agentPermissions.js';
import { resolveActingAgent } from '../requestAgentAuth.js';

export async function taskRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { projectId?: string; channelId?: string; status?: string } }>('/api/tasks', async (req, reply) => {
    const status = req.query.status === undefined ? undefined : TaskStatusSchema.safeParse(req.query.status);
    if (status && !status.success) return reply.status(400).send({ error: 'Invalid status' });
    return getStore().listTasks({
      projectId: req.query.projectId,
      channelId: req.query.channelId,
      status: status?.success ? status.data : undefined,
    });
  });

  app.post('/api/tasks', async (req, reply) => {
    const parsed = CreateTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const actingAgent = await resolveActingAgent(req, reply);
    if (reply.sent) return reply;
    if (actingAgent && !(await requireAgentPermission(actingAgent.id, 'createTasks'))) {
      return reply.status(403).send({ error: 'Agent does not have permission: create_tasks' });
    }
    const channel = await getStore().getChannel(parsed.data.channelId, { projectId: parsed.data.projectId });
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    const assignee = parsed.data.assigneeId ? await getStore().findAgentByNameOrId(parsed.data.assigneeId) : undefined;
    if (parsed.data.assigneeId && !assignee) return reply.status(422).send({ error: 'Unknown assignee' });

    const taskId = nanoid();
    const dependencyError = await validateTaskDependencies(taskId, parsed.data.context?.blockedByTaskIds);
    if (dependencyError) return reply.status(422).send({ error: dependencyError });

    const task = await getStore().createTask({
      id: taskId,
      projectId: channel.projectId,
      channelId: parsed.data.channelId,
      messageId: parsed.data.messageId,
      title: parsed.data.title,
      status: parsed.data.status,
      type: parsed.data.type,
      creatorName: parsed.data.creatorName,
      creator: { actorType: parsed.data.creatorType, actorId: parsed.data.creatorId ?? parsed.data.creatorName },
      assigneeId: assignee?.id,
      owner: assignee ? { actorType: parsed.data.ownerType ?? 'agent', actorId: parsed.data.ownerId ?? assignee.id } : undefined,
      reviewer: actorFromPatch(parsed.data.reviewerType, parsed.data.reviewerId),
      acceptanceCriteria: parsed.data.acceptanceCriteria,
      definitionOfDone: parsed.data.definitionOfDone,
      constraints: parsed.data.constraints,
      dependsOn: parsed.data.dependsOn ?? parsed.data.context?.blockedByTaskIds,
      isBlocked: parsed.data.isBlocked,
      blockedReason: parsed.data.blockedReason,
      sourceChannelId: parsed.data.sourceChannelId ?? parsed.data.channelId,
      sourceThreadId: parsed.data.sourceThreadId,
      context: parsed.data.context,
    });
    await getStore().appendAuditLog({
      projectId: task.projectId,
      actorType: parsed.data.creatorType,
      actorId: parsed.data.creatorId ?? parsed.data.creatorName,
      action: 'task.created',
      entityType: 'task',
      entityId: task.id,
      taskId: task.id,
      detailJson: { status: task.status, type: task.type },
    });
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    return reply.status(201).send(task);
  });

  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const parsed = PatchTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const { expectedVersion, ...patch } = parsed.data;
    const store = getStore();
    const existing = await store.getTask(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Task not found' });
    if (expectedVersion !== undefined && expectedVersion !== existing.version) {
      return reply.status(409).send({ error: 'Task version conflict', currentVersion: existing.version });
    }
    if (patch.status && !isTaskTransitionAllowed(existing.status, patch.status)) {
      return reply.status(422).send({ error: 'Invalid task status transition', from: existing.status, to: patch.status });
    }
    const { ownerType, ownerId, reviewerType, reviewerId, ...taskPatch } = patch;
    const dependencyError = await validateTaskDependencies(existing.id, taskPatch.dependsOn ?? taskPatch.context?.blockedByTaskIds);
    if (dependencyError) return reply.status(422).send({ error: dependencyError });
    if (taskPatch.status === 'in_progress') {
      const blockersError = await validateBlockersComplete({ ...existing, ...taskPatch });
      if (blockersError) return reply.status(422).send({ error: blockersError });
    }
    const assignee = taskPatch.assigneeId ? await store.findAgentByNameOrId(taskPatch.assigneeId) : undefined;
    if (taskPatch.assigneeId && !assignee) return reply.status(422).send({ error: 'Unknown assignee' });
    const task = await store.updateTask(req.params.id, {
      ...taskPatch,
      assigneeId: assignee?.id,
      owner: actorFromPatch(ownerType, ownerId) ?? (assignee ? { actorType: 'agent', actorId: assignee.id } : undefined),
      reviewer: actorFromPatch(reviewerType, reviewerId),
    });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (patch.status && patch.status !== existing.status) {
      await store.appendAuditLog({
        projectId: task.projectId,
        actorType: existing.creator.actorType,
        actorId: existing.creator.actorId,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: task.id,
        taskId: task.id,
        detailJson: { from: existing.status, to: task.status, expectedVersion },
      });
    }
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    if (task.status === 'done' && existing.status !== 'done') await notifyTasksBlockedBy(task.id);
    return task;
  });

  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const ok = await getStore().deleteTask(req.params.id);
    if (!ok) return reply.status(404).send({ error: 'Task not found' });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/messages/:id/to-task', async (req, reply) => {
    const store = getStore();
    const message = await store.getMessage(req.params.id);
    if (!message) return reply.status(404).send({ error: 'Message not found' });
    const parsed = MessageToTaskRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const assignee = parsed.data.assigneeId ? await store.findAgentByNameOrId(parsed.data.assigneeId) : undefined;
    if (parsed.data.assigneeId && !assignee) return reply.status(422).send({ error: 'Unknown assignee' });

    const task = await store.createTask({
      id: nanoid(),
      projectId: message.projectId,
      channelId: message.channelId,
      messageId: message.id,
      title: message.content.slice(0, 200),
      status: 'backlog',
      creatorName: parsed.data.creatorName,
      creator: { actorType: parsed.data.creatorType, actorId: parsed.data.creatorId ?? parsed.data.creatorName },
      assigneeId: assignee?.id,
      owner: assignee ? { actorType: 'agent', actorId: assignee.id } : undefined,
      type: 'feature',
      isBlocked: false,
      sourceChannelId: message.channelId,
      sourceThreadId: message.threadRootId,
      context: {
        ...parsed.data.context,
        sourceMessageIds: Array.from(new Set([...(parsed.data.context?.sourceMessageIds ?? []), message.id])),
      },
    });
    eventBus.emit({ type: 'task:update', task });
    await notifyTaskAssignee(task);
    return reply.status(201).send(task);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/reviews', async (req, reply) => {
    const task = await getStore().getTask(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return task.context?.reviews ?? [];
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/reviews', async (req, reply) => {
    const store = getStore();
    const task = await store.getTask(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    const parsed = CreateTaskReviewRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (isHighRisk(task) && parsed.data.requesterAgentId && parsed.data.reviewerAgentId === parsed.data.requesterAgentId && !parsed.data.allowSelfReview) {
      return reply.status(400).send({ error: 'High risk task requires a different reviewer' });
    }
    if (!isTaskTransitionAllowed(task.status, 'in_review')) {
      return reply.status(422).send({ error: 'Invalid task status transition', from: task.status, to: 'in_review' });
    }
    const review = createReview(task.id, parsed.data);
    const taskUpdated = await store.updateTask(task.id, {
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
    if (!taskUpdated) return reply.status(404).send({ error: 'Task not found' });
    if (taskUpdated.status !== task.status) {
      await store.appendAuditLog({
        projectId: taskUpdated.projectId,
        actorType: parsed.data.requesterAgentId ? 'agent' : 'human',
        actorId: parsed.data.requesterAgentId ?? task.creator.actorId,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: taskUpdated.id,
        taskId: taskUpdated.id,
        detailJson: { from: task.status, to: taskUpdated.status, reason: 'review_requested' },
      });
    }
    eventBus.emit({ type: 'task:update', task: taskUpdated });
    return reply.status(201).send(review);
  });

  app.post<{ Params: { id: string } }>('/api/reviews/:id/approve', async (req, reply) => {
    return reviewDecision(req.params.id, req.body, 'approved', reply);
  });

  app.post<{ Params: { id: string } }>('/api/reviews/:id/request-changes', async (req, reply) => {
    return reviewDecision(req.params.id, req.body, 'changes_requested', reply);
  });
}

async function reviewDecision(reviewId: string, body: unknown, status: 'approved' | 'changes_requested', reply: any) {
  const parsed = ReviewDecisionRequestSchema.safeParse(body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
  const store = getStore();
    const task = (await store.listTasks()).find((candidate) => candidate.context?.reviews?.some((review) => review.id === reviewId));
  if (!task) return reply.status(404).send({ error: 'Review not found' });
  const nextTaskStatus = status === 'approved' ? 'done' : 'changes_requested';
  if (!isTaskTransitionAllowed(task.status, nextTaskStatus)) {
    return reply.status(422).send({ error: 'Invalid task status transition', from: task.status, to: nextTaskStatus });
  }
  const now = new Date().toISOString();
  const reviews = (task.context?.reviews ?? []).map((review) => review.id === reviewId
    ? { ...review, reviewerAgentId: parsed.data.reviewerAgentId ?? review.reviewerAgentId, status, comment: parsed.data.comment, checklist: review.checklist.map((item) => ({ ...item, checked: status === 'approved' ? true : item.checked })), updatedAt: now }
    : review);
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
      projectId: updated.projectId,
      actorType: parsed.data.reviewerAgentId ? 'agent' : 'human',
      actorId: parsed.data.reviewerAgentId ?? task.creator.actorId,
      action: 'task.status_changed',
      entityType: 'task',
      entityId: updated.id,
      taskId: updated.id,
      detailJson: { from: task.status, to: updated.status, reason: status },
    });
  }
  eventBus.emit({ type: 'task:update', task: updated });
  return reply.status(200).send(reviews.find((review) => review.id === reviewId));
}

function createReview(taskId: string, data: { requesterAgentId?: string; reviewerAgentId?: string; evidence: string[]; checklist: Array<string | { label: string; checked: boolean }>; comment?: string }): TaskReview {
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

function isHighRisk(task: { context?: { risks?: string[] } }): boolean {
  return (task.context?.risks ?? []).some((risk) => /high|production|payment|legal|privacy|credential|高风险|上线|支付|隐私/.test(risk.toLowerCase()));
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

function actorFromPatch(actorType: ActorType | undefined, actorId: string | undefined): { actorType: ActorType; actorId: string } | undefined {
  return actorId ? { actorType: actorType ?? 'agent', actorId } : undefined;
}

async function validateTaskDependencies(taskId: string, blockedByTaskIds: string[] | undefined): Promise<string | undefined> {
  if (!blockedByTaskIds?.length) return undefined;
  if (blockedByTaskIds.includes(taskId)) return 'Circular task dependency';
  const store = getStore();
  for (const blockerId of blockedByTaskIds) {
    const blocker = await store.getTask(blockerId);
    if (!blocker) return 'Unknown task dependency';
    if (await hasDependencyPath(blockerId, taskId, new Set([taskId]))) {
      return 'Circular task dependency';
    }
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
