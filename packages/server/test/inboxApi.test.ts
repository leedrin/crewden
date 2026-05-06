import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';
import { paseoRuntimeService } from '../src/runtime/paseo-runtime-service.js';

describe('inbox API', () => {
  beforeEach(async () => {
    await resetStore();
    vi.restoreAllMocks();
    vi.spyOn(paseoRuntimeService, 'deliverMessage').mockResolvedValue(true);
    vi.spyOn(paseoRuntimeService, 'startAgent').mockResolvedValue(true);
    vi.spyOn(paseoRuntimeService, 'stopAgent').mockResolvedValue(true);
    vi.spyOn(paseoRuntimeService, 'resolveStartMachineId').mockImplementation((agent) => agent.machineId ?? 'paseo-runtime');
  });

  it('aggregates assigned tasks, mentions, review requests, and thread updates', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      displayName: 'Bot',
      runtime: 'claude',
      status: 'idle',
      projectId: 'default',
      createdAt: new Date().toISOString(),
    });
    await store.createAgent({
      id: 'agent-qa',
      name: 'qa',
      displayName: 'QA',
      runtime: 'claude',
      status: 'idle',
      projectId: 'default',
      createdAt: new Date().toISOString(),
    });
    const token = (await store.getOrCreateAgentToken('agent-1')).token;
    const headers = { Authorization: `Bearer ${token}`, 'X-Agent-Id': 'agent-1' };

    const root = await store.createMessage({
      id: 'thread-root',
      projectId: 'default',
      channelId: 'general',
      senderName: 'user',
      actorType: 'human',
      actorId: 'user',
      content: '启动线程',
    });
    await store.createTask({
      id: 'task-assigned',
      projectId: 'default',
      channelId: 'general',
      title: 'assigned task',
      status: 'in_progress',
      creatorName: 'user',
      assigneeId: 'agent-1',
      sourceThreadId: root.id,
      context: { blockedReason: 'waiting on review' },
    });
    await store.createTask({
      id: 'task-review',
      projectId: 'default',
      channelId: 'general',
      title: 'review task',
      status: 'in_review',
      creatorName: 'user',
      context: {
        reviews: [{
          id: 'review-1',
          taskId: 'task-review',
          reviewerAgentId: 'agent-1',
          requesterAgentId: 'agent-qa',
          status: 'requested',
          evidence: [],
          checklist: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      },
    });
    await store.createMessage({
      id: 'mention-1',
      projectId: 'default',
      channelId: 'general',
      senderName: 'user',
      actorType: 'human',
      actorId: 'user',
      content: '@Bot 请看一下',
      mentions: [{ type: 'agent', id: 'agent-1', label: 'Bot' }],
      threadRootId: root.id,
    });

    const inbox = await app.inject({
      method: 'GET',
      url: '/internal/agent/agent-1/inbox?limit=50',
      headers,
    });
    expect(inbox.statusCode).toBe(200);
    const payload = inbox.json() as Array<{ kind: string }>;
    expect(payload.some((item) => item.kind === 'assigned_task' || item.kind === 'task_blocked')).toBe(true);
    expect(payload.some((item) => item.kind === 'mention')).toBe(true);
    expect(payload.some((item) => item.kind === 'review_request')).toBe(true);
    expect(payload.some((item) => item.kind === 'thread_update')).toBe(true);

    const mentionOnly = await app.inject({
      method: 'GET',
      url: '/internal/agent/agent-1/inbox?kind=mention&limit=50',
      headers,
    });
    expect(mentionOnly.statusCode).toBe(200);
    const mentionItems = mentionOnly.json() as Array<{ kind: string }>;
    expect(mentionItems.length).toBeGreaterThan(0);
    expect(mentionItems.every((item) => item.kind === 'mention')).toBe(true);

    await app.close();
  });
});
