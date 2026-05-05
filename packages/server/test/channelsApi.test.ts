import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('channel API', () => {
  it('creates channels and lists them', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/api/channels', payload: { name: ' 产品 讨论 ' } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: '产品 讨论' });

    const listed = await app.inject({ method: 'GET', url: '/api/channels' });
    expect(listed.json().map((channel: any) => channel.name)).toContain('产品 讨论');
    await app.close();
  });

  it('rejects duplicate channel names', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/channels', payload: { name: 'ops' } });
    const duplicate = await app.inject({ method: 'POST', url: '/api/channels', payload: { name: 'ops' } });
    expect(duplicate.statusCode).toBe(409);
    await app.close();
  });

  it('deletes a channel and its messages and tasks', async () => {
    const app = await buildApp();
    const channel = (await app.inject({ method: 'POST', url: '/api/channels', payload: { name: 'ops' } })).json();
    await getStore().createMessage({ id: 'msg-1', channelId: channel.id, senderName: 'user', content: 'delete me' });
    await getStore().createTask({ id: 'task-1', channelId: channel.id, title: 'delete task', status: 'backlog', creatorName: 'user' });

    const deleted = await app.inject({ method: 'DELETE', url: `/api/channels/${channel.id}` });
    expect(deleted.statusCode).toBe(204);
    expect(await getStore().getChannel(channel.id)).toBeUndefined();
    expect(await getStore().listMessages(channel.id)).toHaveLength(0);
    expect(await getStore().listTasks({ channelId: channel.id })).toHaveLength(0);
    await app.close();
  });

  it('does not delete general', async () => {
    const app = await buildApp();
    const deleted = await app.inject({ method: 'DELETE', url: '/api/channels/general' });
    expect(deleted.statusCode).toBe(400);
    await app.close();
  });
});
