import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { CreateProjectRequestSchema, PatchProjectRequestSchema } from '@crewden/shared';
import { getStore } from '../db.js';

export async function projectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async () => {
    return getStore().listProjects();
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const project = await getStore().getProject(req.params.id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return project;
  });

  app.post('/api/projects', async (req, reply) => {
    const parsed = CreateProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const slug = normalizeSlug(parsed.data.slug);
    if (!slug) return reply.status(400).send({ error: 'Invalid slug' });
    const bySlug = await getStore().getProjectBySlug(slug);
    if (bySlug) return reply.status(409).send({ error: 'Project slug already exists' });
    const project = await getStore().createProject({
      id: nanoid(),
      name: parsed.data.name,
      slug,
      description: parsed.data.description,
      paseoProjectId: parsed.data.paseoProjectId,
    });
    return reply.status(201).send(project);
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const parsed = PatchProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    const existing = await getStore().getProject(req.params.id);
    if (!existing) return reply.status(404).send({ error: 'Project not found' });
    const nextSlug = parsed.data.slug === undefined ? existing.slug : normalizeSlug(parsed.data.slug);
    if (!nextSlug) return reply.status(400).send({ error: 'Invalid slug' });
    if (nextSlug !== existing.slug) {
      const conflict = await getStore().getProjectBySlug(nextSlug);
      if (conflict && conflict.id !== existing.id) return reply.status(409).send({ error: 'Project slug already exists' });
    }
    const project = await getStore().updateProject(existing.id, {
      ...parsed.data,
      slug: nextSlug,
    });
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return project;
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const project = await getStore().getProject(req.params.id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    if (project.id === 'default') return reply.status(400).send({ error: 'Default project cannot be deleted' });

    const [channelCount, taskCount, agentCount, decisionCount, documentCount] = await Promise.all([
      getStore().listChannels({ projectId: project.id }).then((items) => items.length),
      getStore().listTasks({ projectId: project.id }).then((items) => items.length),
      getStore().listAgents({ projectId: project.id }).then((items) => items.length),
      getStore().listDecisions({ projectId: project.id }).then((items) => items.length),
      getStore().listDocuments({ projectId: project.id }).then((items) => items.length),
    ]);

    if (channelCount > 0 || taskCount > 0 || agentCount > 0 || decisionCount > 0 || documentCount > 0) {
      return reply.status(409).send({
        error: 'Project is not empty; migrate or clean resources before delete',
        detail: { channels: channelCount, tasks: taskCount, agents: agentCount, decisions: decisionCount, documents: documentCount },
      });
    }

    const deleted = await getStore().deleteProject(project.id);
    if (!deleted) return reply.status(404).send({ error: 'Project not found' });
    return reply.status(204).send();
  });
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
}
