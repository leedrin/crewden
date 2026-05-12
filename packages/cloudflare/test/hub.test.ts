import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

const WEB_TOKEN = 'test-web-token';
const DAEMON_KEY = 'test-daemon-key';

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${WEB_TOKEN}`, ...(extra ?? {}) };
}

async function connectDaemon(): Promise<WebSocket> {
  const res = await SELF.fetch(`https://hub.test/daemon/connect?key=${DAEMON_KEY}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  expect(ws).toBeTruthy();
  if (!ws) throw new Error('missing websocket');
  ws.accept();
  return ws;
}

function waitForMessage(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve) => {
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type === type) resolve(msg);
    });
  });
}

describe('browser auth', () => {
  it('returns public hub version info', async () => {
    const res = await SELF.fetch('https://hub.test/api/version');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { component: string; version: string };
    expect(body.component).toBe('cloudflare-hub');
    expect(body.version).toBeTruthy();
  });

  it('rejects /api/* without token', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels');
    expect(res.status).toBe(401);
  });

  it('rejects /api/* with wrong token', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts /api/* with correct token', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels', { headers: authHeaders() });
    expect(res.status).toBe(200);
    const channels = (await res.json()) as Array<{ name: string }>;
    expect(channels.find((c) => c.name === 'general')).toBeTruthy();
  });

  it('returns auth status with correct token', async () => {
    const res = await SELF.fetch('https://hub.test/api/auth/whoami', { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authenticated: true, mode: 'token' });
  });

  it('creates display-oriented channel names', async () => {
    const name = `产品 讨论 ${crypto.randomUUID()}`;
    const created = await SELF.fetch('https://hub.test/api/channels', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: ` ${name} ` }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ name });
  });

  it('allows OPTIONS preflight without token', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels', { method: 'OPTIONS' });
    expect(res.status).toBe(200);
  });
});

describe('agent internal API', () => {
  it('authenticates agent token and supports messages, dm, and delegation', async () => {
    const daemon = await connectDaemon();
    daemon.send(JSON.stringify({
      type: 'ready',
      machineId: `internal-machine-${crypto.randomUUID()}`,
      hostname: 'internal-host',
      os: 'test',
      daemonVersion: 'test',
      runtimes: ['claude'],
      runtimeVersions: {},
      runningAgents: [],
      capabilities: [],
    }));

    const created = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: `internal-agent-${crypto.randomUUID()}`, runtime: 'claude' }),
    });
    const agent = (await created.json()) as { id: string; name: string };

    const startMsgPromise = waitForMessage(daemon, 'agent:start');
    const started = await SELF.fetch(`https://hub.test/api/agents/${agent.id}/start`, { method: 'POST', headers: authHeaders() });
    expect(started.status).toBe(200);
    const startMsg = await startMsgPromise;
    const token = startMsg.config.agentToken;
    expect(token).toBeTruthy();

    const missing = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/auth/whoami`);
    expect(missing.status).toBe(401);

    const internalHeaders = { Authorization: `Bearer ${token}`, 'X-Agent-Id': agent.id, 'Content-Type': 'application/json' };
    const whoami = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/auth/whoami`, { headers: internalHeaders });
    expect(whoami.status).toBe(200);

    const sent = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/messages/send`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ channel: 'general', content: 'internal hello' }),
    });
    expect(sent.status).toBe(201);
    expect(await sent.json()).toMatchObject({ content: 'internal hello' });

    const targetCreated = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: `internal-target-${crypto.randomUUID()}`,
        displayName: `产品经理-${crypto.randomUUID()}`,
        description: 'Product manager for task triage',
        runtime: 'claude',
      }),
    });
    const target = (await targetCreated.json()) as { id: string; name: string; displayName: string };

    const resolved = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/agents/resolve?query=${encodeURIComponent(target.displayName)}`, { headers: internalHeaders });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ match: { id: target.id }, confidence: 'exact_display_name' });

    const dm = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/dms/send`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ to: target.name, content: 'private internal' }),
    });
    expect(dm.status).toBe(201);

    const delegation = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/delegate`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ to: target.name, content: 'handle work', startIfInactive: false }),
    });
    expect(delegation.status).toBe(201);
    expect(await delegation.json()).toMatchObject({ status: 'queued' });

    const taskCreated = await SELF.fetch('https://hub.test/api/tasks', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channelId: 'general', title: `internal task ${crypto.randomUUID()}`, creatorName: 'user', assigneeId: agent.id, status: 'assigned', context: { goal: 'cloudflare internal task' } }),
    });
    expect(taskCreated.status).toBe(201);
    const task = (await taskCreated.json()) as { id: string; title: string };

    const tasks = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks`, { headers: internalHeaders });
    expect(tasks.status).toBe(200);
    expect((await tasks.json()) as Array<{ id: string }>).toContainEqual(expect.objectContaining({ id: task.id }));

    const taskRead = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks/${task.id}`, { headers: internalHeaders });
    expect(taskRead.status).toBe(200);
    const taskReadBody = (await taskRead.json()) as {
      title: string;
      context?: {
        goal?: string;
        contextPackage?: {
          taskId: string;
          generatedAt: string;
          stale?: boolean;
          staleReason?: string;
        };
      };
    };
    expect(taskReadBody).toMatchObject({ title: task.title, context: { goal: 'cloudflare internal task' } });
    expect(taskReadBody.context?.contextPackage).toBeDefined();

    const taskUpdated = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks/${task.id}/update`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(taskUpdated.status).toBe(200);
    expect(await taskUpdated.json()).toMatchObject({ status: 'in_progress' });

    const staleMarked = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        context: {
          ...taskReadBody.context,
          contextPackage: {
            ...taskReadBody.context?.contextPackage,
            stale: true,
            staleReason: 'document updated: doc-1',
          },
        },
      }),
    });
    expect(staleMarked.status).toBe(200);
    const refreshedRead = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks/${task.id}`, { headers: internalHeaders });
    expect(refreshedRead.status).toBe(200);
    const refreshedBody = (await refreshedRead.json()) as {
      context?: { contextPackage?: { stale?: boolean; staleReason?: string; sections?: Array<unknown> } };
    };
    expect(refreshedBody.context?.contextPackage?.stale).not.toBe(true);
    expect(refreshedBody.context?.contextPackage?.staleReason).toBeUndefined();
    expect(refreshedBody.context?.contextPackage?.sections?.length ?? 0).toBeGreaterThan(0);

    const taskHandoff = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks/${task.id}/handoff`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ to: target.name, notes: 'cloudflare handoff', nextStep: 'continue' }),
    });
    expect(taskHandoff.status).toBe(200);
    expect(await taskHandoff.json()).toMatchObject({
      assigneeId: target.id,
      context: {
        goal: 'cloudflare internal task',
        previousAgentId: agent.id,
        handoffNotes: [expect.stringContaining('cloudflare handoff')],
      },
    });

    const internalGoalCreated = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/goals`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ channel: 'general', objective: 'cloudflare internal goal', successCriteria: ['tasks have context'] }),
    });
    expect(internalGoalCreated.status).toBe(201);
    const internalGoal = (await internalGoalCreated.json()) as { id: string };

    const internalGoals = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/goals?status=draft`, { headers: internalHeaders });
    expect(internalGoals.status).toBe(200);
    expect((await internalGoals.json()) as Array<{ id: string }>).toContainEqual(expect.objectContaining({ id: internalGoal.id }));

    const internalGoalTasks = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/goals/${internalGoal.id}/tasks`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ tasks: [{ title: 'cloudflare goal task', acceptanceCriteria: ['tasks have context'] }] }),
    });
    expect(internalGoalTasks.status).toBe(201);
    expect(await internalGoalTasks.json()).toMatchObject({
      tasks: [expect.objectContaining({ context: expect.objectContaining({ goalId: internalGoal.id, acceptanceCriteria: ['tasks have context'] }) })],
    });

    const claimableTask = await SELF.fetch('https://hub.test/api/tasks', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channelId: 'general', title: `${agent.name} coding work ${crypto.randomUUID()}`, creatorName: 'user', context: { goal: 'coding' } }),
    });
    const claimable = (await claimableTask.json()) as { id: string };

    const inbox = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/inbox`, { headers: internalHeaders });
    expect(inbox.status).toBe(200);
    expect((await inbox.json()) as Array<{ kind: string; taskId?: string }>).toContainEqual(expect.objectContaining({ kind: 'claimable_task', taskId: claimable.id }));

    const claimed = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks/${claimable.id}/claim`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({}),
    });
    expect(claimed.status).toBe(200);
    const claimedBody = (await claimed.json()) as { assigneeId: string; context?: { claimedByAgentId?: string; contextPackage?: unknown } };
    expect(claimedBody).toMatchObject({ assigneeId: agent.id, context: expect.objectContaining({ claimedByAgentId: agent.id }) });
    expect(claimedBody.context?.contextPackage).toBeDefined();
    const messages = await SELF.fetch('https://hub.test/api/channels/general/messages', { headers: authHeaders() });
    expect(messages.status).toBe(200);
    expect(await messages.json()).toContainEqual(expect.objectContaining({
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: expect.stringContaining(`I have claimed task #${claimable.id}`),
      mentions: [{ type: 'user', id: 'user', label: 'user' }],
    }));

    const progress = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks/${claimable.id}/progress`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ detail: 'heartbeat' }),
    });
    expect(progress.status).toBe(200);
    expect(await progress.json()).toMatchObject({ context: expect.objectContaining({ progressEvents: expect.arrayContaining([expect.objectContaining({ type: 'heartbeat' })]) }) });

    const blocked = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks/${claimable.id}/block`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ reason: 'missing input', needs: 'user decision' }),
    });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toMatchObject({ context: expect.objectContaining({ blockedReason: 'missing input', blockedNeeds: 'user decision' }) });

    const readyTaskCreated = await SELF.fetch('https://hub.test/api/tasks', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channelId: 'general', title: `cf ready task ${crypto.randomUUID()}`, creatorName: 'user', status: 'ready' }),
    });
    expect(readyTaskCreated.status).toBe(201);
    const readyTask = (await readyTaskCreated.json()) as { id: string };
    const internalAssigned = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks/${readyTask.id}/update`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ status: 'assigned', assigneeId: agent.id }),
    });
    expect(internalAssigned.status).toBe(200);
    expect(await internalAssigned.json()).toMatchObject({
      status: 'assigned',
      assigneeId: agent.id,
      context: expect.objectContaining({ contextPackage: expect.any(Object) }),
    });

    const reviewTaskCreated = await SELF.fetch('https://hub.test/api/tasks', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channelId: 'general', title: `cf review task ${crypto.randomUUID()}`, creatorName: 'user', assigneeId: agent.id, type: 'docs' }),
    });
    const reviewTask = (await reviewTaskCreated.json()) as { id: string };
    const reviewReady = await SELF.fetch(`https://hub.test/api/tasks/${reviewTask.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'ready' }),
    });
    expect(reviewReady.status).toBe(200);
    const reviewAssigned = await SELF.fetch(`https://hub.test/api/tasks/${reviewTask.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'assigned' }),
    });
    expect(reviewAssigned.status).toBe(200);
    const reviewStarted = await SELF.fetch(`https://hub.test/api/tasks/${reviewTask.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(reviewStarted.status).toBe(200);
    const reviewRequested = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/tasks/${reviewTask.id}/reviews`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ reviewerAgentId: agent.id, evidence: ['cloudflare tests passed'], checklist: ['evidence exists'] }),
    });
    expect(reviewRequested.status).toBe(201);
    const review = (await reviewRequested.json()) as { id: string };

    const reviews = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/reviews`, { headers: internalHeaders });
    expect(reviews.status).toBe(200);
    expect((await reviews.json()) as Array<{ id: string }>).toContainEqual(expect.objectContaining({ id: review.id }));

    const approved = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/reviews/${review.id}/approve`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ comment: 'verified' }),
    });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ status: 'approved' });

    const knowledgeWritten = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/knowledge`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ kind: 'runbook', title: 'Cloudflare review runbook', summary: 'Review evidence before approval.', body: 'Use review list and approve only after checking evidence.', tags: ['review'], sourceRefs: ['task:review'] }),
    });
    expect(knowledgeWritten.status).toBe(201);
    const knowledge = (await knowledgeWritten.json()) as { id: string };
    const knowledgeSearch = await SELF.fetch(`https://hub.test/internal/agent/${agent.id}/knowledge?query=runbook&tag=review`, { headers: internalHeaders });
    expect(knowledgeSearch.status).toBe(200);
    expect((await knowledgeSearch.json()) as Array<{ entry: { id: string } }>).toContainEqual(expect.objectContaining({ entry: expect.objectContaining({ id: knowledge.id }) }));
    daemon.close();
  });
});

describe('input validation', () => {
  it('returns 400 for invalid agent body', async () => {
    const res = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid request body');
  });

  it('creates agent with valid body', async () => {
    const res = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'a', runtime: 'claude' }),
    });
    expect(res.status).toBe(201);
    const agent = (await res.json()) as { id: string; name: string; status: string };
    expect(agent.name).toBe('a');
    expect(agent.status).toBe('inactive');
    expect((agent as any).autoStart).toBe(false);
  });

  it('rejects empty message content', async () => {
    const res = await SELF.fetch('https://hub.test/api/channels/general/messages', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ senderName: 'u', content: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects PATCH with empty body', async () => {
    const created = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'b', runtime: 'claude' }),
    });
    const agent = (await created.json()) as { id: string };
    const res = await SELF.fetch(`https://hub.test/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('updates runtime for an inactive agent', async () => {
    const created = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: `runtime-edit-${crypto.randomUUID()}`, runtime: 'claude' }),
    });
    const agent = (await created.json()) as { id: string };
    const patched = await SELF.fetch(`https://hub.test/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ runtime: 'codex' }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ runtime: 'codex' });
  });

  it('rejects runtime changes while an agent is busy', async () => {
    const machineId = `runtime-busy-${crypto.randomUUID()}`;
    const daemon = await connectDaemon();
    daemon.send(JSON.stringify({
      type: 'ready',
      machineId,
      hostname: 'host-runtime-busy',
      os: 'darwin',
      daemonVersion: '1.5.1',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0.0' },
      runningAgents: [],
      capabilities: [],
    }));
    await new Promise((r) => setTimeout(r, 80));
    const created = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: `busy-runtime-${crypto.randomUUID()}`, runtime: 'claude', machineId }),
    });
    const agent = (await created.json()) as { id: string };
    const started = await SELF.fetch(`https://hub.test/api/agents/${agent.id}/start`, { method: 'POST', headers: authHeaders() });
    expect(started.status).toBe(200);
    const patched = await SELF.fetch(`https://hub.test/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ runtime: 'codex' }),
    });
    expect(patched.status).toBe(409);
    expect((await patched.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('Stop the agent first') });
    daemon.close();
  });

  it('validates machine support when patching runtime', async () => {
    const machineId = `runtime-machine-${crypto.randomUUID()}`;
    const daemon = await connectDaemon();
    daemon.send(JSON.stringify({
      type: 'ready',
      machineId,
      hostname: 'host-runtime-machine',
      os: 'darwin',
      daemonVersion: '1.5.1',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0.0' },
      runningAgents: [],
      capabilities: [],
    }));
    await new Promise((r) => setTimeout(r, 80));
    const created = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: `bound-runtime-${crypto.randomUUID()}`, runtime: 'claude', machineId }),
    });
    const agent = (await created.json()) as { id: string };
    const patched = await SELF.fetch(`https://hub.test/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ runtime: 'codex' }),
    });
    expect(patched.status).toBe(400);
    expect((await patched.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('Machine does not support runtime codex') });
    daemon.close();
  });

  it('persists thread replies separately from channel messages', async () => {
    const agentCreated = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: `mention-target-${crypto.randomUUID()}`, displayName: '产品经理', runtime: 'claude' }),
    });
    const agent = (await agentCreated.json()) as { id: string };

    const rootCreated = await SELF.fetch('https://hub.test/api/channels/general/messages', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ senderName: 'user', content: 'Root @产品经理' }),
    });
    expect(rootCreated.status).toBe(201);
    const root = (await rootCreated.json()) as { id: string; mentions?: Array<{ id: string; label: string }> };
    expect(root.mentions).toEqual([{ type: 'agent', id: agent.id, label: '产品经理' }]);

    const replyCreated = await SELF.fetch('https://hub.test/api/channels/general/messages', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ senderName: 'user', content: 'Thread reply', threadRootId: root.id }),
    });
    expect(replyCreated.status).toBe(201);
    const reply = (await replyCreated.json()) as { id: string; threadRootId?: string };
    expect(reply.threadRootId).toBe(root.id);

    const listed = await SELF.fetch('https://hub.test/api/channels/general/messages', { headers: authHeaders() });
    expect(listed.status).toBe(200);
    const messages = (await listed.json()) as Array<{ id: string; replyCount?: number }>;
    const listedRoot = messages.find((message) => message.id === root.id);
    expect(listedRoot).toMatchObject({ replyCount: 1 });
    expect(messages.find((message) => message.id === reply.id)).toBeUndefined();

    const thread = await SELF.fetch(`https://hub.test/api/messages/${root.id}/thread`, { headers: authHeaders() });
    expect(thread.status).toBe(200);
    expect(await thread.json()).toMatchObject({ root: { id: root.id }, replies: [{ id: reply.id }] });
  });

  it('supports task board CRUD and message conversion', async () => {
    const title = `cf task ${crypto.randomUUID()}`;
    const created = await SELF.fetch('https://hub.test/api/tasks', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channelId: 'general', title, creatorName: 'user', type: 'docs', context: { goal: 'cloudflare task board' } }),
    });
    expect(created.status).toBe(201);
    const task = (await created.json()) as { id: string; title: string; status: string };
    expect(task.title).toBe(title);
    expect(task.status).toBe('backlog');
    expect((task as any).context.goal).toBe('cloudflare task board');

    const ready = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'ready' }),
    });
    expect(ready.status).toBe(200);

    const assigned = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'assigned' }),
    });
    expect(assigned.status).toBe(200);

    const started = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(started.status).toBe(200);

    const inReview = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'in_review' }),
    });
    expect(inReview.status).toBe(200);

    const patched = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'done' }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()) as { status: string }).toMatchObject({ status: 'done' });

    const listed = await SELF.fetch('https://hub.test/api/tasks?status=done', { headers: authHeaders() });
    expect(listed.status).toBe(200);
    const tasks = (await listed.json()) as Array<{ id: string }>;
    expect(tasks.find((candidate) => candidate.id === task.id)).toBeTruthy();

    const message = await SELF.fetch('https://hub.test/api/channels/general/messages', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ senderName: 'user', content: `task from message ${crypto.randomUUID()}` }),
    });
    const msg = (await message.json()) as { id: string; content: string };
    const converted = await SELF.fetch(`https://hub.test/api/messages/${msg.id}/to-task`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ creatorName: 'user' }),
    });
    expect(converted.status).toBe(201);
    expect(await converted.json()).toMatchObject({ messageId: msg.id, title: msg.content });
  });

  it('supports public task review request and decisions', async () => {
    const created = await SELF.fetch('https://hub.test/api/tasks', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channelId: 'general', title: `cf public review ${crypto.randomUUID()}`, creatorName: 'user', type: 'docs', context: { risks: ['medium'] } }),
    });
    const task = (await created.json()) as { id: string };
    const ready = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'ready' }),
    });
    expect(ready.status).toBe(200);
    const assigned = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'assigned' }),
    });
    expect(assigned.status).toBe(200);
    const started = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(started.status).toBe(200);
    const requested = await SELF.fetch(`https://hub.test/api/tasks/${task.id}/reviews`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requesterAgentId: 'dev', reviewerAgentId: 'qa', evidence: ['dry run passed'], checklist: ['evidence exists'] }),
    });
    expect(requested.status).toBe(201);
    const review = (await requested.json()) as { id: string };

    const reviews = await SELF.fetch(`https://hub.test/api/tasks/${task.id}/reviews`, { headers: authHeaders() });
    expect(reviews.status).toBe(200);
    expect((await reviews.json()) as Array<{ id: string }>).toContainEqual(expect.objectContaining({ id: review.id }));

    const changes = await SELF.fetch(`https://hub.test/api/reviews/${review.id}/request-changes`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reviewerAgentId: 'qa', comment: 'add web evidence' }),
    });
    expect(changes.status).toBe(200);
    expect(await changes.json()).toMatchObject({ status: 'changes_requested' });

    const changedTaskRes = await SELF.fetch('https://hub.test/api/tasks', { headers: authHeaders() });
    expect(changedTaskRes.status).toBe(200);
    const changedTask = ((await changedTaskRes.json()) as Array<{ id: string; version: number; status: string }>).find((candidate) => candidate.id === task.id);
    if (!changedTask) throw new Error('Changed task not found');
    expect(changedTask.status).toBe('changes_requested');

    const resumed = await SELF.fetch(`https://hub.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'in_progress', expectedVersion: changedTask.version }),
    });
    expect(resumed.status).toBe(200);

    const requestedAgain = await SELF.fetch(`https://hub.test/api/tasks/${task.id}/reviews`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requesterAgentId: 'dev', reviewerAgentId: 'qa', evidence: ['web evidence added'], checklist: ['evidence exists'] }),
    });
    expect(requestedAgain.status).toBe(201);
    const secondReview = (await requestedAgain.json()) as { id: string };

    const approved = await SELF.fetch(`https://hub.test/api/reviews/${secondReview.id}/approve`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reviewerAgentId: 'qa', comment: 'verified' }),
    });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ status: 'approved', checklist: [expect.objectContaining({ checked: true })] });
  });

  it('supports public knowledge CRUD and goal archive', async () => {
    const created = await SELF.fetch('https://hub.test/api/knowledge', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ kind: 'decision', title: 'CF V1 test env', summary: 'Use test hub.', body: 'Keep production isolated.', tags: ['v1'], sourceRefs: ['goal:v1'] }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string };

    const searched = await SELF.fetch('https://hub.test/api/knowledge?query=test&kind=decision&tag=v1', { headers: authHeaders() });
    expect(searched.status).toBe(200);
    expect((await searched.json()) as Array<{ entry: { id: string } }>).toContainEqual(expect.objectContaining({ entry: expect.objectContaining({ id: entry.id }) }));

    const patched = await SELF.fetch(`https://hub.test/api/knowledge/${entry.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'stale' }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ status: 'stale' });

    const goalCreated = await SELF.fetch('https://hub.test/api/goals', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ objective: `archive goal ${crypto.randomUUID()}`, requesterName: 'user', channelId: 'general', successCriteria: ['archived'] }),
    });
    const goal = (await goalCreated.json()) as { id: string };
    const archived = await SELF.fetch(`https://hub.test/api/goals/${goal.id}/archive`, { method: 'POST', headers: authHeaders() });
    expect(archived.status).toBe(201);
    expect(await archived.json()).toMatchObject({ kind: 'project_archive', sourceRefs: expect.arrayContaining([`goal:${goal.id}`]) });
  });

  it('supports goal brief CRUD, message conversion, and task breakdown', async () => {
    const message = await SELF.fetch('https://hub.test/api/channels/general/messages', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ senderName: 'user', content: `plan v1 goal ${crypto.randomUUID()}` }),
    });
    const msg = (await message.json()) as { id: string; content: string };
    const goalCreated = await SELF.fetch(`https://hub.test/api/messages/${msg.id}/to-goal`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requesterName: 'user', successCriteria: ['agent tasks are ready'] }),
    });
    expect(goalCreated.status).toBe(201);
    const goal = (await goalCreated.json()) as { id: string; objective: string };
    expect(goal.objective).toBe(msg.content);

    const patched = await SELF.fetch(`https://hub.test/api/goals/${goal.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'confirmed', constraints: ['test env only'] }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ status: 'confirmed', constraints: ['test env only'] });

    const breakdown = await SELF.fetch(`https://hub.test/api/goals/${goal.id}/tasks`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ creatorName: 'user', tasks: [{ title: 'write v1 goal plan' }] }),
    });
    expect(breakdown.status).toBe(201);
    expect(await breakdown.json()).toMatchObject({
      tasks: [expect.objectContaining({ context: expect.objectContaining({ goalId: goal.id, goalObjective: msg.content }) })],
    });

    const read = await SELF.fetch(`https://hub.test/api/goals/${goal.id}`, { headers: authHeaders() });
    expect(read.status).toBe(200);
    expect((await read.json()) as { tasks: Array<{ title: string }> }).toMatchObject({ tasks: [expect.objectContaining({ title: 'write v1 goal plan' })] });
  });

  it('supports chat-native goal alignment and confirmation', async () => {
    const pmCreated = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: `pm-${crypto.randomUUID()}`,
        runtime: 'claude',
        organization: { roles: ['Product Manager'], capabilities: ['requirements planning'] },
      }),
    });
    const qaCreated = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: `qa-${crypto.randomUUID()}`,
        runtime: 'claude',
        organization: { roles: ['QA'], capabilities: ['quality review'] },
      }),
    });
    const pm = (await pmCreated.json()) as { id: string };
    const qa = (await qaCreated.json()) as { id: string };
    const message = await SELF.fetch('https://hub.test/api/channels/general/messages', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ senderName: 'user', content: `帮我做一个 Mac 全局语音输入法，从需求到技术方案都安排一下 ${crypto.randomUUID()}` }),
    });
    const msg = (await message.json()) as { id: string; content: string };
    const started = await SELF.fetch(`https://hub.test/api/messages/${msg.id}/start-goal-alignment`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requesterName: 'user' }),
    });
    expect(started.status).toBe(201);
    const alignment = (await started.json()) as { id: string; recommendedAgentIds: string[]; reviewerAgentIds: string[] };
    expect(alignment.recommendedAgentIds).toContain(pm.id);
    expect(alignment.reviewerAgentIds).toContain(qa.id);

    const confirmed = await SELF.fetch(`https://hub.test/api/goal-alignments/${alignment.id}/confirm`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requesterName: 'user' }),
    });
    expect(confirmed.status).toBe(201);
    const confirmedBody = (await confirmed.json()) as { goal: { objective: string; status: string }; tasks: Array<{ context?: { goalObjective?: string } }> };
    expect(confirmedBody.goal).toMatchObject({ objective: msg.content, status: 'confirmed' });
    expect(confirmedBody.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ context: expect.objectContaining({ goalObjective: msg.content }) }),
    ]));
  });

  it('updates profile fields and stores direct messages', async () => {
    const created = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: `dm-target-${crypto.randomUUID()}`, runtime: 'claude' }),
    });
    const agent = (await created.json()) as { id: string };

    const patched = await SELF.fetch(`https://hub.test/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ displayName: 'Direct Target', description: 'DM ready', envVars: { A: 'B' } }),
    });
    expect(patched.status).toBe(200);
    const updated = (await patched.json()) as { displayName?: string; description?: string; envVars?: Record<string, string> };
    expect(updated.displayName).toBe('Direct Target');
    expect(updated.description).toBe('DM ready');
    expect(updated.envVars?.A).toBe('B');

    const dmRes = await SELF.fetch(`https://hub.test/api/agents/${agent.id}/dms/user`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ content: 'private hello' }),
    });
    expect(dmRes.status).toBe(201);
    const dm = (await dmRes.json()) as { fromAgentId: string; toAgentId: string; content: string };
    expect(dm.fromAgentId).toBe('user');
    expect(dm.toAgentId).toBe(agent.id);
    expect(dm.content).toBe('private hello');

    const threadsRes = await SELF.fetch(`https://hub.test/api/agents/${agent.id}/dms`, { headers: authHeaders() });
    expect(threadsRes.status).toBe(200);
    const threads = (await threadsRes.json()) as Array<{ otherAgentId: string }>;
    expect(threads.find((thread) => thread.otherAgentId === 'user')).toBeTruthy();

    const messagesRes = await SELF.fetch(`https://hub.test/api/agents/${agent.id}/dms/user`, { headers: authHeaders() });
    expect(messagesRes.status).toBe(200);
    const messages = (await messagesRes.json()) as Array<{ content: string }>;
    expect(messages.map((message) => message.content)).toContain('private hello');
  });

  it('stores delegation and starts an inactive target with a wake message', async () => {
    const daemonRes = await SELF.fetch(`https://hub.test/daemon/connect?key=${DAEMON_KEY}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(daemonRes.status).toBe(101);
    const ws = daemonRes.webSocket;
    expect(ws).toBeTruthy();
    if (!ws) return;
    ws.accept();
    ws.send(JSON.stringify({
      type: 'ready',
      machineId: 'delegate-machine',
      hostname: 'delegate-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0.0' },
      runningAgents: [],
      capabilities: [],
    }));
    await new Promise((r) => setTimeout(r, 80));

    const senderRes = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: `delegate-sender-${crypto.randomUUID()}`, runtime: 'claude' }),
    });
    const sender = (await senderRes.json()) as { id: string };
    const targetName = `delegate-target-${crypto.randomUUID()}`;
    const targetRes = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: targetName, runtime: 'claude' }),
    });
    const target = (await targetRes.json()) as { id: string };

    const startPromise = new Promise<any>((resolve) => {
      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'agent:start') resolve(msg);
      });
    });

    const delegationRes = await SELF.fetch(`https://hub.test/api/agents/${sender.id}/delegate/${targetName.toLowerCase()}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ content: 'please handle cloudflare work' }),
    });
    expect(delegationRes.status).toBe(201);
    const delegation = (await delegationRes.json()) as { status: string; toAgentId: string };
    expect(delegation.status).toBe('started');
    expect(delegation.toAgentId).toBe(target.id);

    const start = await startPromise;
    expect(start.agentId).toBe(target.id);
    expect(start.wakeMessage.content).toBe('please handle cloudflare work');
    ws.close();
  });
});

describe('agent recovery', () => {
  it('sets autoStart on start and clears it on stop', async () => {
    const daemon = await connectDaemon();
    daemon.send(JSON.stringify({
      type: 'ready',
      machineId: 'machine-recovery-1',
      hostname: 'host-recovery-1',
      os: 'darwin',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0.0' },
      runningAgents: [],
      capabilities: [],
    }));
    await new Promise((r) => setTimeout(r, 80));

    const created = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'recovery-agent-1', runtime: 'claude', machineId: 'machine-recovery-1' }),
    });
    const agent = (await created.json()) as { id: string };

    const startMessage = waitForMessage(daemon, 'agent:start');
    const started = await SELF.fetch(`https://hub.test/api/agents/${agent.id}/start`, {
      method: 'POST',
      headers: authHeaders(),
    });
    expect(started.status).toBe(200);
    expect(await startMessage).toMatchObject({ type: 'agent:start', agentId: agent.id });
    expect(await started.json()).toMatchObject({ status: 'starting', autoStart: true });

    const stopped = await SELF.fetch(`https://hub.test/api/agents/${agent.id}/stop`, {
      method: 'POST',
      headers: authHeaders(),
    });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ status: 'inactive', autoStart: false });
    daemon.close();
  });

  it('auto-starts enabled agents on daemon ready', async () => {
    const created = await SELF.fetch('https://hub.test/api/agents', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'recovery-agent-2', runtime: 'claude' }),
    });
    const agent = (await created.json()) as { id: string };
    await SELF.fetch(`https://hub.test/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ autoStart: true }),
    });

    const daemon = await connectDaemon();
    const startMessage = waitForMessage(daemon, 'agent:start');
    daemon.send(JSON.stringify({
      type: 'ready',
      machineId: 'machine-recovery-2',
      hostname: 'host-recovery-2',
      os: 'darwin',
      daemonVersion: '0.1.0',
      runtimes: ['claude'],
      runtimeVersions: { claude: '1.0.0' },
      runningAgents: [],
      capabilities: [],
    }));

    expect(await startMessage).toMatchObject({ type: 'agent:start', agentId: agent.id });
    daemon.close();
  });
});

describe('daemon connection', () => {
  it('rejects missing daemon key', async () => {
    const res = await SELF.fetch('https://hub.test/daemon/connect', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects wrong daemon key', async () => {
    const res = await SELF.fetch('https://hub.test/daemon/connect?key=wrong', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts daemon with valid key and registers machine on ready', async () => {
    const res = await SELF.fetch(`https://hub.test/daemon/connect?key=${DAEMON_KEY}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    expect(ws).toBeTruthy();
    if (!ws) return;
    ws.accept();

    ws.send(
      JSON.stringify({
        type: 'ready',
        machineId: 'machine-test-1',
        hostname: 'host-1',
        os: 'darwin',
        daemonVersion: '0.1.0',
        runtimes: ['claude'],
        runtimeVersions: { claude: '1.0.0' },
        runningAgents: [],
        capabilities: [],
      }),
    );

    // Allow ready message processing
    await new Promise((r) => setTimeout(r, 80));

    const machinesRes = await SELF.fetch('https://hub.test/api/machines', { headers: authHeaders() });
    expect(machinesRes.status).toBe(200);
    const machines = (await machinesRes.json()) as Array<{ id: string; status: string }>;
    expect(machines.find((m) => m.id === 'machine-test-1' && m.status === 'online')).toBeTruthy();

    ws.close();
  });
});

describe('browser websocket auth', () => {
  it('rejects /ws without token', async () => {
    const res = await SELF.fetch('https://hub.test/ws', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(401);
  });

  it('accepts /ws with correct token', async () => {
    const res = await SELF.fetch(`https://hub.test/ws?token=${WEB_TOKEN}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();
  });
});
