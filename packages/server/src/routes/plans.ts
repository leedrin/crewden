import type { FastifyInstance } from 'fastify';
import { CreatePlanRequestSchema, ReviewPlanRequestSchema, type ActorType } from '@crewden/shared';
import { getDb, getStore } from '../db.js';
import { SqlitePlanRepository } from '../repository/plan.repository.js';
import { SqliteApprovalRepository } from '../repository/approval.repository.js';
import { eventBus } from '../events.js';

function getPlanRepo() {
  return new SqlitePlanRepository(getDb());
}

function getApprovalRepo() {
  return new SqliteApprovalRepository(getDb());
}

export async function planRoutes(app: FastifyInstance) {
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/plan', async (req, reply) => {
    const plan = await getPlanRepo().getByTaskId(req.params.taskId);
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });
    return plan;
  });

  app.post<{ Params: { taskId: string } }>('/api/tasks/:taskId/plan', async (req, reply) => {
    const parsed = CreatePlanRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const task = await getStore().getTask(req.params.taskId);
    if (!task) return reply.status(404).send({ error: 'Task not found' });

    const existing = await getPlanRepo().getByTaskId(req.params.taskId);
    if (existing) return reply.status(409).send({ error: 'Plan already exists for this task' });

    const plan = await getPlanRepo().create({
      projectId: parsed.data.projectId ?? task.projectId,
      taskId: req.params.taskId,
      approach: parsed.data.approach,
      steps: parsed.data.steps,
      risks: parsed.data.risks,
      filesToModify: parsed.data.filesToModify,
      filesToCreate: parsed.data.filesToCreate,
      testsToAdd: parsed.data.testsToAdd,
      authorType: 'agent' as ActorType,
      authorId: task.assigneeId ?? 'unknown',
    });

    eventBus.emit({ type: 'plan:update', plan });
    return reply.status(201).send(plan);
  });

  app.post<{ Params: { taskId: string } }>('/api/tasks/:taskId/plan/submit', async (req, reply) => {
    const repo = getPlanRepo();
    const plan = await repo.getByTaskId(req.params.taskId);
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });
    if (plan.status !== 'draft') return reply.status(422).send({ error: `Cannot submit plan in ${plan.status} status` });

    const updated = await repo.updateStatus(plan.id, 'submitted');
    if (updated) eventBus.emit({ type: 'plan:update', plan: updated });
    return updated;
  });

  app.post<{ Params: { taskId: string }; Body: { reviewerType?: string; reviewerId?: string; approved: boolean; comment?: string } }>('/api/tasks/:taskId/plan/review', async (req, reply) => {
    const parsed = ReviewPlanRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });

    const repo = getPlanRepo();
    const plan = await repo.getByTaskId(req.params.taskId);
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });
    if (plan.status !== 'submitted') return reply.status(422).send({ error: `Cannot review plan in ${plan.status} status` });

    const reviewerType = (req.body.reviewerType ?? 'agent') as ActorType;
    const reviewerId = req.body.reviewerId ?? 'reviewer';

    const updated = await repo.review(plan.id, {
      reviewerType,
      reviewerId,
      approved: parsed.data.approved,
      comment: parsed.data.comment,
    });

    if (updated) {
      eventBus.emit({ type: 'plan:update', plan: updated });

      if (updated.status === 'approved') {
        const task = await getStore().getTask(req.params.taskId);
        if (task && (task.type === 'feature' || task.type === 'bug')) {
          const approval = await getApprovalRepo().create({
            projectId: task.projectId,
            type: 'task_execution',
            targetId: task.id,
            requestedByType: 'agent',
            requestedById: task.assigneeId ?? plan.authorId,
            reason: `Plan approved for ${task.type} task: ${task.title}`,
            context: `Plan: ${plan.approach}`,
          });
          eventBus.emit({ type: 'approval:update', approval });
        }
      }
    }

    return updated;
  });
}
