import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('document api', () => {
  it('creates and filters documents by kind/status', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        kind: 'prd',
        title: 'V2 planning',
        content: '# PRD',
        sourceChannelId: 'general',
        authorType: 'human',
        authorId: 'user',
        authorName: 'user',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ kind: 'prd', status: 'draft' });

    const list = await app.inject({ method: 'GET', url: '/api/documents?kind=prd&status=draft' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    await app.close();
  });

  it('enforces review + approve lifecycle', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        kind: 'tdd',
        title: 'Implementation plan',
        content: 'details',
        sourceChannelId: 'general',
        authorType: 'human',
        authorId: 'user',
        authorName: 'user',
      },
    });
    const id = created.json().id as string;

    const submitted = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/submit-review`,
      payload: { reviewers: [{ actorType: 'agent', actorId: 'agent-qa' }] },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().status).toBe('in_review');

    const approveDenied = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/approve`,
      payload: { actorType: 'agent', actorId: 'agent-dev' },
    });
    expect(approveDenied.statusCode).toBe(403);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/approve`,
      payload: { actorType: 'agent', actorId: 'agent-qa' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('approved');
    await app.close();
  });

  it('supports deprecate/supersede from approved only and writes audit log', async () => {
    const app = await buildApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        kind: 'runbook',
        title: 'Runbook A',
        content: 'A',
        sourceChannelId: 'general',
        authorType: 'human',
        authorId: 'user',
        authorName: 'user',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        kind: 'runbook',
        title: 'Runbook B',
        content: 'B',
        sourceChannelId: 'general',
        authorType: 'human',
        authorId: 'user',
        authorName: 'user',
      },
    });
    const firstId = first.json().id as string;
    const secondId = second.json().id as string;
    for (const id of [firstId, secondId]) {
      await app.inject({
        method: 'POST',
        url: `/api/documents/${id}/submit-review`,
        payload: { reviewers: [{ actorType: 'human', actorId: 'user' }] },
      });
      await app.inject({
        method: 'POST',
        url: `/api/documents/${id}/approve`,
        payload: { actorType: 'human', actorId: 'user' },
      });
    }

    const superseded = await app.inject({
      method: 'POST',
      url: `/api/documents/${firstId}/supersede`,
      payload: { supersededBy: secondId },
    });
    expect(superseded.statusCode).toBe(200);
    expect(superseded.json()).toMatchObject({ status: 'superseded', supersededBy: secondId });

    const logs = await getStore().listAuditLogs({ entityType: 'document', entityId: firstId });
    expect(logs.some((log) => log.action === 'document.status_changed')).toBe(true);
    await app.close();
  });
});
