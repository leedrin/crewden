import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('decision api', () => {
  it('creates and lists decisions by channel/status', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        channelId: 'general',
        title: 'Use SQLite for local dev',
        problem: 'Need deterministic local data',
        decisionText: 'Use SQLite',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe('proposed');

    const list = await app.inject({ method: 'GET', url: '/api/channels/general/decisions?status=proposed' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    await app.close();
  });

  it('enforces decision status transitions', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        channelId: 'general',
        title: 'Adopt branch strategy',
        problem: 'Need consistent collaboration',
        decisionText: 'Use feature branches',
      },
    });
    const id = created.json().id as string;

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/api/decisions/${id}`,
      payload: { status: 'accepted' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe('accepted');

    const deprecated = await app.inject({ method: 'POST', url: `/api/decisions/${id}/deprecate` });
    expect(deprecated.statusCode).toBe(200);
    expect(deprecated.json().status).toBe('deprecated');

    const invalid = await app.inject({ method: 'POST', url: `/api/decisions/${id}/supersede`, payload: { supersededBy: id } });
    expect(invalid.statusCode).toBe(422);
    await app.close();
  });

  it('supports supersede with replacement decision and writes audit log', async () => {
    const app = await buildApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        channelId: 'general',
        title: 'First decision',
        problem: 'P1',
        decisionText: 'A',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: {
        channelId: 'general',
        title: 'Second decision',
        problem: 'P2',
        decisionText: 'B',
      },
    });
    const firstId = first.json().id as string;
    const secondId = second.json().id as string;
    await app.inject({ method: 'PATCH', url: `/api/decisions/${firstId}`, payload: { status: 'accepted' } });
    await app.inject({ method: 'PATCH', url: `/api/decisions/${secondId}`, payload: { status: 'accepted' } });

    const superseded = await app.inject({
      method: 'POST',
      url: `/api/decisions/${firstId}/supersede`,
      payload: { supersededBy: secondId },
    });
    expect(superseded.statusCode).toBe(200);
    expect(superseded.json()).toMatchObject({ status: 'superseded', supersededBy: secondId });

    const logs = await getStore().listAuditLogs({ entityType: 'decision', entityId: firstId });
    expect(logs.some((log) => log.action === 'decision.status_changed')).toBe(true);
    await app.close();
  });
});
