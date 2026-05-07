import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('context package API', () => {
  it('generates context package when task is created with assigned status', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'dev',
      displayName: 'Developer',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'implement auth',
        creatorName: 'user',
        assigneeId: 'agent-1',
        status: 'assigned',
        acceptanceCriteria: ['tests pass'],
        context: { goal: 'auth system' },
      },
    });
    expect(created.statusCode, created.json()?.error ?? 'ok').toBe(201);
    const task = created.json();
    expect(task.context?.contextPackage).toBeDefined();
    expect(task.context.contextPackage.taskId).toBe(task.id);
    expect(task.context.contextPackage.sections.length).toBeGreaterThanOrEqual(1);
    expect(task.context.contextPackage.sections[0].source).toBe('task');

    await app.close();
  });

  it('regenerates context package via dedicated endpoint', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'dev',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'build api',
        creatorName: 'user',
        assigneeId: 'agent-1',
        status: 'assigned',
      },
    });
    expect(created.statusCode, created.json()?.error ?? 'ok').toBe(201);
    const taskId = created.json().id;

    const regenerated = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/context-package`,
    });
    expect(regenerated.statusCode, regenerated.json()?.error ?? 'ok').toBe(200);
    expect(regenerated.json().taskId).toBe(taskId);
    expect(regenerated.json().sections.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('returns 422 when regenerating context package for unassigned task', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'unassigned task',
        creatorName: 'user',
      },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id;

    const result = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/context-package`,
    });
    expect(result.statusCode).toBe(422);

    await app.close();
  });

  it('includes decision sections in context package', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'dev',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });

    const decision = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        channelId: 'general',
        title: 'Use JWT',
        problem: 'Need auth',
        decisionText: 'Use JWT with RS256',
        rationale: 'Industry standard',
      },
    });
    expect(decision.statusCode).toBe(201);

    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'implement auth',
        creatorName: 'user',
        assigneeId: 'agent-1',
        status: 'assigned',
        context: { relatedDecisionIds: [decision.json().id] },
      },
    });
    expect(created.statusCode, created.json()?.error ?? 'ok').toBe(201);
    const task = created.json();
    expect(task.context?.contextPackage).toBeDefined();

    const decisionSections = task.context.contextPackage.sections.filter((s: any) => s.source === 'decision');
    expect(decisionSections.length).toBe(1);
    expect(decisionSections[0].title).toContain('Use JWT');

    await app.close();
  });
});
