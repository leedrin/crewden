import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('agent permission enforcement on public API', () => {
  async function createAgentWithToken() {
    const app = await buildApp();
    const store = getStore();
    const created = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'agent-1', runtime: 'codex' },
    });
    const agent = created.json();
    const token = (await store.getOrCreateAgentToken(agent.id)).token;
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-Agent-Id': agent.id,
    };
    return { app, store, agent, headers };
  }

  it('rejects task creation when create_tasks is false', async () => {
    const { app, store, agent, headers } = await createAgentWithToken();
    await store.updateAgent(agent.id, {
      permissions: {
        readChannels: [],
        writeChannels: [],
        createDocs: true,
        createTasks: false,
        claimTasks: true,
        createBranches: false,
        createPrs: false,
        mergeToMain: false,
        deployToProd: false,
        accessSensitiveData: false,
        callExternalApis: [],
        maxContextTokens: 100000,
        requiresApprovalFor: [],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: {
        channelId: 'general',
        title: 'blocked task',
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('rejects message send when channel is outside write_channels allowlist', async () => {
    const { app, store, agent, headers } = await createAgentWithToken();
    await store.updateAgent(agent.id, {
      permissions: {
        readChannels: [],
        writeChannels: ['private-room'],
        createDocs: true,
        createTasks: true,
        claimTasks: true,
        createBranches: false,
        createPrs: false,
        mergeToMain: false,
        deployToProd: false,
        accessSensitiveData: false,
        callExternalApis: [],
        maxContextTokens: 100000,
        requiresApprovalFor: [],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      headers,
      payload: {
        senderName: 'agent-1',
        content: 'should not send',
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
