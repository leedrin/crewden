import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetStore, getStore } from '../src/db.js';

beforeEach(async () => {
  await resetStore();
});

describe('GET /api/channels', () => {
  it('returns default general channel', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/channels' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('general');
    await app.close();
  });
});

describe('GET /api/version', () => {
  it('returns server version info', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.component).toBe('server');
    expect(body.version).toBe(process.env.CREWDEN_VERSION || '1.5.1');
    expect(body.version).toBeTruthy();
    await app.close();
  });
});

describe('GET /api/runtime/status', () => {
  it('returns runtime mode diagnostics', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/runtime/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      mode: expect.any(String),
      configuredMode: expect.any(String),
      connected: expect.any(Boolean),
    });
    await app.close();
  });
});

describe('POST /api/channels/:id/messages', () => {
  it('creates a message', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Hello' },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json();
    expect(msg.content).toBe('Hello');
    expect(msg.channelId).toBe('general');
    await app.close();
  });

  it('returns 404 for unknown channel', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/nonexistent/messages',
      payload: { senderName: 'user', content: 'Hello' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 400 for empty content', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: '' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for missing senderName', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { content: 'hi' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('persists thread replies separately from channel messages', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'pm',
      displayName: '产品经理',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });

    const root = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Root @产品经理' },
    });
    expect(root.statusCode).toBe(201);
    expect(root.json().mentions).toEqual([{ type: 'agent', id: 'agent-1', label: '产品经理' }]);

    const reply = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Thread reply', threadRootId: root.json().id },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({ threadRootId: root.json().id, content: 'Thread reply' });

    const listed = await app.inject({ method: 'GET', url: '/api/channels/general/messages' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ id: root.json().id, replyCount: 1 });

    const thread = await app.inject({ method: 'GET', url: `/api/messages/${root.json().id}/thread` });
    expect(thread.statusCode).toBe(200);
    expect(thread.json().root.id).toBe(root.json().id);
    expect(thread.json().replies).toHaveLength(1);
    expect(thread.json().replies[0].id).toBe(reply.json().id);
    await app.close();
  });

  it('rejects missing or cross-channel thread roots', async () => {
    const app = await buildApp();
    await getStore().createChannel('other', 'other');
    const root = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Root' },
    });

    const missing = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'reply', threadRootId: 'missing' },
    });
    expect(missing.statusCode).toBe(404);

    const cross = await app.inject({
      method: 'POST',
      url: '/api/channels/other/messages',
      payload: { senderName: 'user', content: 'reply', threadRootId: root.json().id },
    });
    expect(cross.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /api/agents', () => {
  it('creates an agent', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'my-agent', runtime: 'claude' },
    });
    expect(res.statusCode).toBe(201);
    const agent = res.json();
    expect(agent.name).toBe('my-agent');
    expect(agent.runtime).toBe('claude');
    expect(agent.status).toBe('inactive');
    expect(agent.autoStart).toBe(false);
    await app.close();
  });

  it('creates an agent with organization profile', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: 'qa-agent',
        runtime: 'claude',
        organization: { department: 'delivery', roles: ['QA'], capabilities: ['quality gate'], availability: 'available' },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().organization).toMatchObject({ department: 'delivery', roles: ['QA'], capabilities: ['quality gate'] });
    await app.close();
  });

  it('returns 400 without required fields', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'no-runtime' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for invalid runtime', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'a', runtime: 'gpt4' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('PATCH /api/agents/:id', () => {
  it('returns 400 when no fields provided', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'a', runtime: 'claude' },
    });
    const agentId = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agentId}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('updates a single field', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'a', runtime: 'claude' },
    });
    const agentId = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agentId}`,
      payload: { displayName: 'New' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe('New');
    const fetched = await app.inject({ method: 'GET', url: `/api/agents/${agentId}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().displayName).toBe('New');
    await app.close();
  });

  it('updates organization profile', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/api/agents', payload: { name: 'a', runtime: 'claude' } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${created.json().id}`,
      payload: { organization: { department: 'product', roles: ['PM'], capabilities: ['requirements'] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().organization.roles).toEqual(['PM']);
    await app.close();
  });

  it('updates runtime for an inactive agent', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/api/agents', payload: { name: 'a', runtime: 'claude' } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${created.json().id}`,
      payload: { runtime: 'codex' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().runtime).toBe('codex');
    await app.close();
  });

  it('rejects runtime changes while an agent is busy', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-busy',
      name: 'busy',
      runtime: 'claude',
      status: 'working',
      createdAt: new Date().toISOString(),
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/agents/agent-busy',
      payload: { runtime: 'codex' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Stop the agent first');
    await app.close();
  });

  it('rejects runtime changes when the bound machine does not support the target runtime', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.upsertMachine({
      id: 'machine-1',
      hostname: 'host',
      os: 'darwin',
      daemonVersion: '1.5.1',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0.0' },
      status: 'online',
      connectedAt: new Date().toISOString(),
    });
    await store.createAgent({
      id: 'agent-bound',
      name: 'bound',
      runtime: 'claude',
      machineId: 'machine-1',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/agents/agent-bound',
      payload: { runtime: 'codex' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Machine does not support runtime codex');
    await app.close();
  });

  it('validates patched machine and runtime together', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.upsertMachine({
      id: 'machine-codex',
      hostname: 'host',
      os: 'darwin',
      daemonVersion: '1.5.1',
      runtimes: ['codex'],
      runtimeVersions: { codex: '1.0.0' },
      status: 'online',
      connectedAt: new Date().toISOString(),
    });
    const created = await app.inject({ method: 'POST', url: '/api/agents', payload: { name: 'a', runtime: 'claude' } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${created.json().id}`,
      payload: { machineId: 'machine-codex', runtime: 'codex' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ machineId: 'machine-codex', runtime: 'codex' });
    await app.close();
  });
});

describe('DELETE /api/agents/:id', () => {
  it('deletes an inactive agent and removes it from the list', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/api/agents', payload: { name: 'delete-me', runtime: 'claude' } });
    const agentId = created.json().id;

    const deleted = await app.inject({ method: 'DELETE', url: `/api/agents/${agentId}` });
    expect(deleted.statusCode).toBe(204);

    const fetched = await app.inject({ method: 'GET', url: `/api/agents/${agentId}` });
    expect(fetched.statusCode).toBe(404);

    const listed = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(listed.json().some((agent: { id: string }) => agent.id === agentId)).toBe(false);
    await app.close();
  });

  it('rejects deleting a working agent', async () => {
    const app = await buildApp();
    await getStore().createAgent({
      id: 'agent-working',
      name: 'working',
      runtime: 'codex',
      status: 'working',
      createdAt: new Date().toISOString(),
    });

    const deleted = await app.inject({ method: 'DELETE', url: '/api/agents/agent-working' });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error).toContain('Stop the agent first');

    const listed = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(listed.json().some((agent: { id: string }) => agent.id === 'agent-working')).toBe(true);
    await app.close();
  });
});

describe('agent direct messages API', () => {
  it('creates a DM and lists it in threads and conversation', async () => {
    const app = await buildApp();
    await getStore().createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/dms/user',
      payload: { content: 'private hello' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ fromAgentId: 'user', toAgentId: 'agent-1', content: 'private hello' });

    const threads = await app.inject({ method: 'GET', url: '/api/agents/agent-1/dms' });
    expect(threads.statusCode).toBe(200);
    expect(threads.json()[0].otherAgentId).toBe('user');

    const conversation = await app.inject({ method: 'GET', url: '/api/agents/agent-1/dms/user' });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json()).toHaveLength(1);
    await app.close();
  });
});

describe('GET /api/agents', () => {
  it('lists agents', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'agent-1', runtime: 'gemini' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    await app.close();
  });
});

describe('GET /api/agents/:id/activities', () => {
  it('returns recent activities for an agent newest first', async () => {
    const app = await buildApp();
    const store = getStore();
    const agent = await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });
    await store.createAgentActivity({ id: 'activity-1', agentId: agent.id, type: 'working', detail: 'Message received' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.createAgentActivity({ id: 'activity-2', agentId: agent.id, type: 'idle' });

    const res = await app.inject({ method: 'GET', url: '/api/agents/agent-1/activities' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('activity-2');
    expect(body[1].detail).toBe('Message received');
    await app.close();
  });

  it('keeps at most 500 activities per agent and API returns recent 200', async () => {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });

    for (let i = 0; i < 501; i += 1) {
      await store.createAgentActivity({ id: `activity-${i}`, agentId: 'agent-1', type: 'output', detail: `line ${i}` });
    }

    expect(await store.listAgentActivities('agent-1', 1000)).toHaveLength(500);
    const res = await app.inject({ method: 'GET', url: '/api/agents/agent-1/activities' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(200);
    await app.close();
  });
});

describe('agent internal API', () => {
  async function createInternalAgent() {
    const app = await buildApp();
    const store = getStore();
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      displayName: 'Bot',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });
    const token = (await store.getOrCreateAgentToken('agent-1')).token;
    const headers = { Authorization: `Bearer ${token}`, 'X-Agent-Id': 'agent-1' };
    return { app, store, headers };
  }

  it('rejects missing and invalid agent tokens', async () => {
    const { app } = await createInternalAgent();

    const missing = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/auth/whoami' });
    expect(missing.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'GET',
      url: '/internal/agent/agent-1/auth/whoami',
      headers: { Authorization: 'Bearer wrong', 'X-Agent-Id': 'agent-1' },
    });
    expect(wrong.statusCode).toBe(401);
    await app.close();
  });

  it('returns whoami and server info for a valid token', async () => {
    const { app, headers } = await createInternalAgent();
    const whoami = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/auth/whoami', headers });
    expect(whoami.statusCode).toBe(200);
    expect(whoami.json().agent.name).toBe('bot');

    const info = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/server/info', headers });
    expect(info.statusCode).toBe(200);
    expect(info.json().channels[0].id).toBe('general');
    expect(info.json().version.component).toBe('server');
    await app.close();
  });

  it('resolves agent ids from display names and role descriptions', async () => {
    const { app, store, headers } = await createInternalAgent();
    await store.createAgent({
      id: 'agent-111',
      name: 'pm-111',
      displayName: '产品经理',
      description: 'Product manager for task triage',
      organization: { department: 'product', roles: ['PM'], capabilities: ['requirements'] },
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });

    const displayName = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/agents/resolve?query=%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86', headers });
    expect(displayName.statusCode).toBe(200);
    expect(displayName.json()).toMatchObject({ match: { id: 'agent-111' }, confidence: 'exact_display_name' });

    const roleHint = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/agents/resolve?query=task%20triage', headers });
    expect(roleHint.statusCode).toBe(200);
    expect(roleHint.json()).toMatchObject({ match: { id: 'agent-111' }, confidence: 'description_hint' });

    const capabilityHint = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/agents/resolve?query=requirements', headers });
    expect(capabilityHint.statusCode).toBe(200);
    expect(capabilityHint.json()).toMatchObject({ match: { id: 'agent-111' }, confidence: 'description_hint' });
    await app.close();
  });

  it('sends and reads channel messages', async () => {
    const { app, headers } = await createInternalAgent();
    const sent = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/messages/send',
      headers,
      payload: { channel: 'general', content: 'hello from cli' },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ channelId: 'general', agentId: 'agent-1', senderName: 'Bot', content: 'hello from cli' });

    const read = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/messages/read?channel=general&limit=5', headers });
    expect(read.statusCode).toBe(200);
    expect(read.json().at(-1).content).toBe('hello from cli');
    await app.close();
  });

  it('sends direct messages and delegates through existing logic', async () => {
    const { app, store, headers } = await createInternalAgent();
    await store.createAgent({
      id: 'agent-2',
      name: 'target',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });

    const dm = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/dms/send',
      headers,
      payload: { to: 'target', content: 'private note' },
    });
    expect(dm.statusCode).toBe(201);
    expect(dm.json()).toMatchObject({ fromAgentId: 'agent-1', toAgentId: 'agent-2', content: 'private note' });

    const delegation = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/delegate',
      headers,
      payload: { to: 'target', content: 'please handle this', startIfInactive: false },
    });
    expect(delegation.statusCode).toBe(201);
    expect(delegation.json()).toMatchObject({ fromAgentId: 'agent-1', toAgentId: 'agent-2', status: 'queued' });
    await app.close();
  });

  it('lists, reads, and updates assigned tasks', async () => {
    const { app, store, headers } = await createInternalAgent();
    const assigned = await store.createTask({
      id: 'task-1',
      channelId: 'general',
      title: 'agent task',
      status: 'todo',
      creatorName: 'user',
      assigneeId: 'agent-1',
      context: { goal: 'complete assigned task' },
    });
    await store.createAgent({
      id: 'agent-2',
      name: 'target',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });
    await store.createTask({
      id: 'task-2',
      channelId: 'general',
      title: 'someone else task',
      status: 'todo',
      creatorName: 'user',
      assigneeId: 'agent-2',
    });

    const listed = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/tasks', headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].id).toBe(assigned.id);

    const read = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/tasks/task-1', headers });
    expect(read.statusCode).toBe(200);
    expect(read.json().title).toBe('agent task');
    expect(read.json().context.goal).toBe('complete assigned task');

    const forbidden = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/tasks/task-2', headers });
    expect(forbidden.statusCode).toBe(403);

    const updated = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-1/update',
      headers,
      payload: { status: 'in_progress' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe('in_progress');

    const handedOff = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-1/handoff',
      headers,
      payload: { to: 'target', notes: 'analysis done', nextStep: 'write tests' },
    });
    expect(handedOff.statusCode).toBe(200);
    expect(handedOff.json().assigneeId).toBe('agent-2');
    expect(handedOff.json().context).toMatchObject({
      goal: 'complete assigned task',
      previousAgentId: 'agent-1',
      handoffNotes: ['from Bot: analysis done\nnext: write tests'],
    });
    await app.close();
  });

  it('returns inbox items and records claim/progress/block/escalation events', async () => {
    const { app, store, headers } = await createInternalAgent();
    await store.updateAgent('agent-1', { organization: { roles: ['Engineer'], capabilities: ['coding'] } });
    await store.createTask({
      id: 'task-claim',
      channelId: 'general',
      title: 'coding task for agent',
      status: 'todo',
      creatorName: 'user',
      context: { goal: 'coding implementation' },
    });

    const inbox = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/inbox', headers });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json()).toContainEqual(expect.objectContaining({ kind: 'claimable_task', taskId: 'task-claim' }));

    const claimed = await app.inject({ method: 'POST', url: '/internal/agent/agent-1/tasks/task-claim/claim', headers });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ assigneeId: 'agent-1', status: 'in_progress', context: { claimedByAgentId: 'agent-1' } });
    expect(claimed.json().context.progressEvents.at(-1)).toMatchObject({ type: 'claimed', agentId: 'agent-1' });
    expect(await store.listMessages('general')).toContainEqual(expect.objectContaining({
      senderName: 'Bot',
      agentId: 'agent-1',
      content: expect.stringContaining('I have claimed task #task-claim'),
      mentions: [{ type: 'user', id: 'user', label: 'user' }],
    }));

    const progress = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-claim/progress',
      headers,
      payload: { detail: 'implemented first slice' },
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json().context.progressEvents.at(-1)).toMatchObject({ type: 'heartbeat', detail: 'implemented first slice' });

    const blocked = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-claim/block',
      headers,
      payload: { reason: 'missing API token', needs: 'user provides token' },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json().context).toMatchObject({ blockedReason: 'missing API token', blockedNeeds: 'user provides token' });

    const escalated = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-claim/escalate',
      headers,
      payload: { reason: 'blocked after retry' },
    });
    expect(escalated.statusCode).toBe(200);
    expect(escalated.json().context).toMatchObject({ escalatedReason: 'blocked after retry' });
    await app.close();
  });

  it('lets agents request and complete task reviews', async () => {
    const { app, store, headers } = await createInternalAgent();
    await store.createAgent({
      id: 'agent-qa',
      name: 'qa',
      displayName: 'QA',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });
    const qaToken = (await store.getOrCreateAgentToken('agent-qa')).token;
    const qaHeaders = { Authorization: `Bearer ${qaToken}`, 'X-Agent-Id': 'agent-qa' };
    await store.createTask({
      id: 'task-review',
      channelId: 'general',
      title: 'review me',
      status: 'in_progress',
      creatorName: 'user',
      assigneeId: 'agent-1',
      context: { acceptanceCriteria: ['has evidence'] },
    });

    const requested = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/tasks/task-review/reviews',
      headers,
      payload: { reviewerAgentId: 'agent-qa', evidence: ['server test passed'], checklist: ['has evidence'], comment: 'ready' },
    });
    expect(requested.statusCode).toBe(201);
    const review = requested.json();
    expect(review).toMatchObject({ requesterAgentId: 'agent-1', reviewerAgentId: 'agent-qa', status: 'requested' });
    expect((await store.getTask('task-review'))?.status).toBe('in_review');

    const qaInbox = await app.inject({ method: 'GET', url: '/internal/agent/agent-qa/inbox', headers: qaHeaders });
    expect(qaInbox.statusCode).toBe(200);
    expect(qaInbox.json()).toContainEqual(expect.objectContaining({ kind: 'review_request', taskId: 'task-review' }));

    const listed = await app.inject({ method: 'GET', url: '/internal/agent/agent-qa/reviews', headers: qaHeaders });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toContainEqual(expect.objectContaining({ id: review.id, task: expect.objectContaining({ id: 'task-review' }) }));

    const changes = await app.inject({
      method: 'POST',
      url: `/internal/agent/agent-qa/reviews/${review.id}/request-changes`,
      headers: qaHeaders,
      payload: { comment: 'add web evidence' },
    });
    expect(changes.statusCode).toBe(200);
    expect(changes.json()).toMatchObject({ status: 'changes_requested', reviewerAgentId: 'agent-qa' });
    expect((await store.getTask('task-review'))?.status).toBe('in_progress');

    const approved = await app.inject({
      method: 'POST',
      url: `/internal/agent/agent-qa/reviews/${review.id}/approve`,
      headers: qaHeaders,
      payload: { comment: 'verified' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved', reviewerAgentId: 'agent-qa' });
    expect((await store.getTask('task-review'))?.status).toBe('done');
    await app.close();
  });

  it('lets agents search, write, read knowledge, and archive goals', async () => {
    const { app, store, headers } = await createInternalAgent();
    const written = await app.inject({
      method: 'POST',
      url: '/internal/agent/agent-1/knowledge',
      headers,
      payload: {
        kind: 'runbook',
        title: 'Run web verification',
        summary: 'Use web tests before acceptance.',
        body: 'Run pnpm --filter @crewden/web test for UI-impacting changes.',
        tags: ['web', 'test'],
        sourceRefs: ['task:test'],
      },
    });
    expect(written.statusCode).toBe(201);
    expect(written.json()).toMatchObject({ ownerAgentId: 'agent-1', kind: 'runbook' });

    const searched = await app.inject({ method: 'GET', url: '/internal/agent/agent-1/knowledge?query=verification&tag=web', headers });
    expect(searched.statusCode).toBe(200);
    expect(searched.json()).toContainEqual(expect.objectContaining({ entry: expect.objectContaining({ id: written.json().id }) }));

    const read = await app.inject({ method: 'GET', url: `/internal/agent/agent-1/knowledge/${written.json().id}`, headers });
    expect(read.statusCode).toBe(200);
    expect(read.json().title).toBe('Run web verification');

    const goal = await store.createGoal({
      id: 'goal-internal',
      channelId: 'general',
      requesterName: 'user',
      objective: 'Internal archive',
      background: [],
      successCriteria: ['Archived'],
      constraints: [],
      assumptions: [],
      risks: [],
      status: 'completed',
    });
    await store.createTask({ id: 'task-internal', channelId: 'general', title: 'Done task', status: 'done', creatorName: 'user', context: { goalId: goal.id } });
    const archived = await app.inject({ method: 'POST', url: '/internal/agent/agent-1/goals/goal-internal/archive', headers });
    expect(archived.statusCode).toBe(201);
    expect(archived.json()).toMatchObject({ kind: 'project_archive', ownerAgentId: 'agent-1' });
    await app.close();
  });
});

describe('GET /api/machines', () => {
  it('returns empty list initially', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/machines' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
    await app.close();
  });
});
