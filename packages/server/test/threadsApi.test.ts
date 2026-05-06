import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';
import { paseoRuntimeService } from '../src/runtime/paseo-runtime-service.js';

describe('threads API', () => {
  beforeEach(async () => {
    process.env.CREWDEN_BROWSER_AUTH_TOKEN = 'test-token';
    await resetStore();
    vi.restoreAllMocks();
    vi.spyOn(paseoRuntimeService, 'deliverMessage').mockResolvedValue(true);
    vi.spyOn(paseoRuntimeService, 'startAgent').mockResolvedValue(true);
    vi.spyOn(paseoRuntimeService, 'stopAgent').mockResolvedValue(true);
    vi.spyOn(paseoRuntimeService, 'resolveStartMachineId').mockImplementation((agent) => agent.machineId ?? 'paseo-runtime');
  });

  it('classifies message intent on create', async () => {
    const app = await buildApp();
    const authHeader = createBrowserAuthHeader();

    const goal = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      headers: authHeader,
      payload: { senderName: 'user', content: '帮我做一个外卖 App 的 MVP 方案' },
    });
    expect(goal.statusCode).toBe(201);
    expect(goal.json().intent).toBe('goal');

    const task = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      headers: authHeader,
      payload: { senderName: 'user', content: 'Review 一下这个 PR' },
    });
    expect(task.statusCode).toBe(201);
    expect(task.json().intent).toBe('task');

    const chat = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      headers: authHeader,
      payload: { senderName: 'user', content: '今天天气不错' },
    });
    expect(chat.statusCode).toBe(201);
    expect(chat.json().intent).toBe('chat');

    await app.close();
  });

  it('generates summary for long threads and final summary when resolved', async () => {
    const app = await buildApp();
    const store = getStore();
    const authHeader = createBrowserAuthHeader();
    const root = await store.createMessage({
      id: 'thread-root',
      projectId: 'default',
      channelId: 'general',
      senderName: 'user',
      actorType: 'human',
      actorId: 'user',
      content: '请推进多步技术方案评审和任务拆解',
    });
    for (let i = 1; i <= 11; i += 1) {
      await store.createMessage({
        id: `reply-${i}`,
        projectId: 'default',
        channelId: 'general',
        senderName: i % 2 === 0 ? 'Bot' : 'user',
        actorType: i % 2 === 0 ? 'agent' : 'human',
        actorId: i % 2 === 0 ? 'agent-1' : 'user',
        threadRootId: root.id,
        content: `第 ${i} 条消息：方案细节和决策讨论？`,
      });
    }

    const summary = await app.inject({
      method: 'GET',
      url: `/api/threads/${root.id}/summary`,
      headers: authHeader,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      threadId: root.id,
      status: 'active',
      messageCount: 12,
    });
    expect(summary.json().summaryContent).toContain('Key points:');

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/threads/${root.id}/resolve`,
      headers: authHeader,
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      status: 'resolved',
      messageCount: 12,
    });
    expect(resolved.json().summaryContent).toContain('Decisions:');

    await app.close();
  });
});

function createBrowserAuthHeader() {
  return { authorization: `Bearer ${process.env.CREWDEN_BROWSER_AUTH_TOKEN ?? 'test-token'}` };
}
