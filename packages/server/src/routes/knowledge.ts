import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { CreateKnowledgeEntryRequestSchema, PatchKnowledgeEntryRequestSchema, SearchKnowledgeRequestSchema, type KnowledgeEntry } from '@crewden/shared';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { requireAgentPermission } from '../agentPermissions.js';
import { resolveActingAgent } from '../requestAgentAuth.js';

export async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/api/knowledge', async (req, reply) => {
    const parsed = SearchKnowledgeRequestSchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    return getStore().searchKnowledge(parsed.data);
  });

  app.post('/api/knowledge', async (req, reply) => {
    const actingAgent = await resolveActingAgent(req, reply);
    if (reply.sent) return reply;
    if (actingAgent && !(await requireAgentPermission(actingAgent.id, 'createDocs'))) {
      return reply.status(403).send({ error: 'Agent does not have permission: create_docs' });
    }
    const parsed = CreateKnowledgeEntryRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    if (parsed.data.sourceRefs.length === 0 && !parsed.data.allowNoSource) return reply.status(400).send({ error: 'sourceRefs are required unless allowNoSource is true' });
    const entry = await getStore().createKnowledgeEntry({
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

  app.get<{ Params: { id: string } }>('/api/knowledge/:id', async (req, reply) => {
    const entry = await getStore().getKnowledgeEntry(req.params.id);
    if (!entry) return reply.status(404).send({ error: 'Knowledge entry not found' });
    return entry;
  });

  app.patch<{ Params: { id: string } }>('/api/knowledge/:id', async (req, reply) => {
    const parsed = PatchKnowledgeEntryRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const entry = await getStore().updateKnowledgeEntry(req.params.id, parsed.data);
    if (!entry) return reply.status(404).send({ error: 'Knowledge entry not found' });
    eventBus.emit({ type: 'knowledge:update', entry });
    return entry;
  });

  app.post<{ Params: { goalId: string } }>('/api/goals/:goalId/archive', async (req, reply) => {
    const entry = await archiveGoal(req.params.goalId);
    if (!entry) return reply.status(404).send({ error: 'Goal not found' });
    return reply.status(201).send(entry);
  });
}

export async function archiveGoal(goalId: string, ownerAgentId?: string): Promise<KnowledgeEntry | undefined> {
  const store = getStore();
  const goal = await store.getGoal(goalId);
  if (!goal) return undefined;
  const tasks = (await store.listTasks({ channelId: goal.channelId })).filter((task) => task.context?.goalId === goal.id);
  const reviews = tasks.flatMap((task) => task.context?.reviews ?? []);
  const evidence = reviews.flatMap((review) => review.evidence);
  const body = [
    `# ${goal.objective}`,
    '',
    '## Success Criteria',
    ...goal.successCriteria.map((item) => `- ${item}`),
    '',
    '## Tasks',
    ...tasks.map((task) => `- [${task.status}] ${task.title}`),
    '',
    '## Review Evidence',
    ...(evidence.length > 0 ? evidence.map((item) => `- ${item}`) : ['- No review evidence recorded.']),
  ].join('\n');
  const entry = await store.createKnowledgeEntry({
    id: nanoid(),
    kind: 'project_archive',
    title: `Archive: ${goal.objective}`.slice(0, 200),
    summary: `${tasks.length} tasks archived for goal ${goal.id}.`,
    body,
    tags: ['project_archive', goal.status, goal.channelId],
    sourceRefs: [`goal:${goal.id}`, ...tasks.map((task) => `task:${task.id}`), ...reviews.map((review) => `review:${review.id}`)],
    ownerAgentId,
    status: 'active',
  });
  eventBus.emit({ type: 'knowledge:update', entry });
  return entry;
}
