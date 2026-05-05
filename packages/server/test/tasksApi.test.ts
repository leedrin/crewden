import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { getStore, resetStore } from '../src/db.js';
import { paseoRuntimeService } from '../src/runtime/paseo-runtime-service.js';

beforeEach(async () => {
  await resetStore();
  vi.restoreAllMocks();
  vi.spyOn(paseoRuntimeService, 'deliverMessage').mockResolvedValue(true);
  vi.spyOn(paseoRuntimeService, 'startAgent').mockResolvedValue(true);
  vi.spyOn(paseoRuntimeService, 'stopAgent').mockResolvedValue(true);
  vi.spyOn(paseoRuntimeService, 'resolveStartMachineId').mockImplementation((agent) => agent.machineId ?? 'paseo-runtime');
});

describe('task API', () => {
  it('creates, lists, updates, and deletes tasks', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'ship task board',
        creatorName: 'user',
        context: { goal: 'ship board', acceptanceCriteria: ['tasks persist context'] },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ channelId: 'general', title: 'ship task board', status: 'backlog' });
    expect(created.json().context.goal).toBe('ship board');
    const taskId = created.json().id;

    const listed = await app.inject({ method: 'GET', url: '/api/tasks?channelId=general' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { status: 'ready', context: { goal: 'ship board', handoffNotes: ['ready for review'] } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe('ready');
    expect(patched.json().context.handoffNotes).toEqual(['ready for review']);

    const filtered = await app.inject({ method: 'GET', url: '/api/tasks?status=ready' });
    expect(filtered.json()).toHaveLength(1);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/tasks/${taskId}` });
    expect(deleted.statusCode).toBe(204);
    expect(await getStore().listTasks()).toHaveLength(0);
    await app.close();
  });

  it('rejects invalid task status transition', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { channelId: 'general', title: 'stateful task', creatorName: 'user' },
    });
    const taskId = created.json().id;

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { status: 'done' },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ error: 'Invalid task status transition' });

    const ready = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { status: 'ready' },
    });
    expect(ready.statusCode).toBe(200);
    const assigned = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { status: 'assigned' },
    });
    expect(assigned.statusCode).toBe(200);
    const started = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { status: 'in_progress' },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().status).toBe('in_progress');

    const blocked = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { isBlocked: true, blockedReason: 'missing input' },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json()).toMatchObject({ status: 'in_progress', isBlocked: true, blockedReason: 'missing input' });

    await app.close();
  });

  it('returns conflict when task version is stale', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { channelId: 'general', title: 'versioned task', creatorName: 'user' },
    });
    const task = created.json();
    expect(task.version).toBe(1);

    const ready = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'ready', expectedVersion: task.version },
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ready', version: 2 });

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'assigned', expectedVersion: task.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'Task version conflict', currentVersion: 2 });

    const current = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'assigned', expectedVersion: ready.json().version },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({ status: 'assigned', version: 3 });

    await app.close();
  });

  it('writes audit log for task status change and handoff', async () => {
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
    await store.createAgent({
      id: 'agent-2',
      name: 'target',
      displayName: 'Target',
      runtime: 'claude',
      status: 'idle',
      createdAt: new Date().toISOString(),
    });
    const token = (await store.getOrCreateAgentToken('agent-1')).token;
    const headers = { Authorization: `Bearer ${token}`, 'X-Agent-Id': 'agent-1' };
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { channelId: 'general', title: 'audited task', creatorName: 'user', assigneeId: 'agent-1' },
    });
    const task = created.json();

    const ready = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'ready', expectedVersion: task.version },
    });
    expect(ready.statusCode).toBe(200);
    const assigned = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'assigned', expectedVersion: ready.json().version },
    });
    expect(assigned.statusCode).toBe(200);
    const started = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'in_progress', expectedVersion: assigned.json().version },
    });
    expect(started.statusCode).toBe(200);

    const handedOff = await app.inject({
      method: 'POST',
      url: `/internal/agent/agent-1/tasks/${task.id}/handoff`,
      headers,
      payload: { to: 'target', notes: 'analysis done', nextStep: 'write tests' },
    });
    expect(handedOff.statusCode).toBe(200);

    const logs = await store.listAuditLogs({ taskId: task.id });
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorType: 'human',
        action: 'task.status_changed',
        entityType: 'task',
        entityId: task.id,
        taskId: task.id,
        detailJson: expect.objectContaining({ from: 'assigned', to: 'in_progress' }),
      }),
      expect.objectContaining({
        actorType: 'agent',
        actorId: 'agent-1',
        action: 'task.handoff',
        entityType: 'task',
        entityId: task.id,
        taskId: task.id,
        agentId: 'agent-1',
        detailJson: expect.objectContaining({ toAgentId: 'agent-2', fromAgentId: 'agent-1' }),
      }),
    ]));
    expect(JSON.stringify(logs)).not.toContain(token);

    await app.close();
  });

  it('does not deliver task while dependency is open', async () => {
    const app = await buildApp();
    const store = getStore();
    const deliverSpy = vi.spyOn(paseoRuntimeService, 'deliverMessage');
    await store.createAgent({
      id: 'agent-1',
      name: 'worker',
      runtime: 'claude',
      status: 'idle',
      machineId: 'paseo-runtime',
      createdAt: new Date().toISOString(),
    });
    const blocker = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { channelId: 'general', title: 'blocker', creatorName: 'user' },
    });

    const dependent = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'dependent',
        creatorName: 'user',
        assigneeId: 'agent-1',
        context: { blockedByTaskIds: [blocker.json().id] },
      },
    });

    expect(dependent.statusCode).toBe(201);
    expect(deliverSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('sends claimable tasks in inbox summary with assigned task delivery', async () => {
    const app = await buildApp();
    const store = getStore();
    const deliverSpy = vi.spyOn(paseoRuntimeService, 'deliverMessage');
    await store.createAgent({
      id: 'agent-1',
      name: 'engineer',
      description: 'implements backend fixes',
      runtime: 'claude',
      status: 'idle',
      machineId: 'paseo-runtime',
      createdAt: new Date().toISOString(),
    });
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { channelId: 'general', title: 'backend pull discovery cleanup', creatorName: 'user' },
    });

    const assigned = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { channelId: 'general', title: 'assigned delivery task', creatorName: 'user', assigneeId: 'agent-1' },
    });

    expect(assigned.statusCode).toBe(201);
    expect(deliverSpy).toHaveBeenCalledTimes(1);
    const call = deliverSpy.mock.calls[0][0];
    expect(call.target.id).toBe('agent-1');
    expect(call.message.channelId).toContain('task:');
    expect(call.inboxSummary).toContain('Open tasks assigned to you:');
    expect(call.inboxSummary).toContain('assigned delivery task');
    expect(call.inboxSummary).toContain('Claimable unassigned tasks matching your role/capability:');
    expect(call.inboxSummary).toContain('backend pull discovery cleanup');
    await app.close();
  });

  it('unblocks dependency when blocker is done', async () => {
    const app = await buildApp();
    const store = getStore();
    const deliverSpy = vi.spyOn(paseoRuntimeService, 'deliverMessage');
    await store.createAgent({
      id: 'agent-1',
      name: 'worker',
      runtime: 'claude',
      status: 'idle',
      machineId: 'paseo-runtime',
      createdAt: new Date().toISOString(),
    });
    const blocker = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { channelId: 'general', title: 'blocker', creatorName: 'user' },
    });
    const dependent = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'dependent',
        creatorName: 'user',
        assigneeId: 'agent-1',
        context: { blockedByTaskIds: [blocker.json().id] },
      },
    });
    expect(deliverSpy).not.toHaveBeenCalled();

    const ready = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${blocker.json().id}`,
      payload: { status: 'ready', expectedVersion: blocker.json().version },
    });
    const assigned = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${blocker.json().id}`,
      payload: { status: 'assigned', expectedVersion: ready.json().version },
    });
    const started = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${blocker.json().id}`,
      payload: { status: 'in_progress', expectedVersion: assigned.json().version },
    });
    const review = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${blocker.json().id}`,
      payload: { status: 'in_review', expectedVersion: started.json().version },
    });
    const done = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${blocker.json().id}`,
      payload: { status: 'done', expectedVersion: review.json().version },
    });

    expect(done.statusCode).toBe(200);
    expect(deliverSpy).toHaveBeenCalledTimes(1);
    const call = deliverSpy.mock.calls[0][0];
    expect(call.target.id).toBe('agent-1');
    expect(call.message.channelId).toBe(`task:${dependent.json().id}`);
    await app.close();
  });

  it('rejects circular task dependency', async () => {
    const app = await buildApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { channelId: 'general', title: 'first', creatorName: 'user' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'second',
        creatorName: 'user',
        context: { blockedByTaskIds: [first.json().id] },
      },
    });

    const cycle = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${first.json().id}`,
      payload: { context: { blockedByTaskIds: [second.json().id] }, expectedVersion: first.json().version },
    });

    expect(cycle.statusCode).toBe(422);
    expect(cycle.json()).toMatchObject({ error: 'Circular task dependency' });
    await app.close();
  });

  it('creates a task from a message', async () => {
    const app = await buildApp();
    const message = await app.inject({
      method: 'POST',
      url: '/api/channels/general/messages',
      payload: { senderName: 'user', content: 'Turn this message into a task' },
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/messages/${message.json().id}/to-task`,
      payload: { creatorName: 'user', context: { goal: 'convert message into work' } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      channelId: 'general',
      messageId: message.json().id,
      title: 'Turn this message into a task',
    });
    expect(created.json().context).toMatchObject({
      goal: 'convert message into work',
      sourceMessageIds: [message.json().id],
    });
    await app.close();
  });

  it('rejects invalid task bodies', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/tasks/nope', payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/tasks?status=not_a_status' })).statusCode).toBe(400);
    await app.close();
  });

  it('requests review with evidence, approves, and requests changes', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'reviewable task',
        creatorName: 'user',
        context: { risks: ['medium'], acceptanceCriteria: ['evidence exists'] },
      },
    });
    const taskId = created.json().id;

    const requested = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/reviews`,
      payload: {
        requesterAgentId: 'agent-dev',
        reviewerAgentId: 'agent-qa',
        evidence: ['pnpm verify passed'],
        checklist: ['evidence exists'],
        comment: 'ready for QA',
      },
    });
    expect(requested.statusCode).toBe(201);
    const review = requested.json();
    expect(review).toMatchObject({ taskId, reviewerAgentId: 'agent-qa', status: 'requested', evidence: ['pnpm verify passed'] });

    const inReview = await getStore().getTask(taskId);
    expect(inReview?.status).toBe('in_review');
    expect(inReview?.context?.evidence).toEqual(['pnpm verify passed']);

    const changes = await app.inject({
      method: 'POST',
      url: `/api/reviews/${review.id}/request-changes`,
      payload: { reviewerAgentId: 'agent-qa', comment: 'add browser test evidence' },
    });
    expect(changes.statusCode).toBe(200);
    expect(changes.json()).toMatchObject({ status: 'changes_requested', comment: 'add browser test evidence' });
    expect((await getStore().getTask(taskId))?.status).toBe('in_progress');

    const approved = await app.inject({
      method: 'POST',
      url: `/api/reviews/${review.id}/approve`,
      payload: { reviewerAgentId: 'agent-qa', comment: 'evidence and checklist verified' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved' });
    expect(approved.json().checklist[0].checked).toBe(true);
    expect((await getStore().getTask(taskId))?.status).toBe('done');
    await app.close();
  });

  it('blocks high-risk self-review unless explicitly allowed with a reason', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        channelId: 'general',
        title: 'production deploy',
        creatorName: 'user',
        context: { risks: ['high production risk'] },
      },
    });
    const taskId = created.json().id;
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/reviews`,
      payload: { requesterAgentId: 'agent-1', reviewerAgentId: 'agent-1', evidence: ['deploy log'], checklist: ['rollback ready'] },
    });
    expect(blocked.statusCode).toBe(400);

    const allowed = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/reviews`,
      payload: {
        requesterAgentId: 'agent-1',
        reviewerAgentId: 'agent-1',
        evidence: ['deploy log'],
        checklist: ['rollback ready'],
        allowSelfReview: true,
        selfReviewReason: 'single-agent emergency drill',
      },
    });
    expect(allowed.statusCode).toBe(201);
    expect((await getStore().getTask(taskId))?.context?.reviewNotes?.at(-1)).toContain('single-agent emergency drill');
    await app.close();
  });
});
