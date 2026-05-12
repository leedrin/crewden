import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetStore } from '../src/db.js';
import { expireDueApprovals } from '../src/reminders.js';
import type { FastifyInstance } from 'fastify';

describe('Plan API', () => {
  let app: FastifyInstance;
  let taskId: string;

  beforeEach(async () => {
    await resetStore();
    app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: 'agent-1',
        runtime: 'claude',
        status: 'idle',
      },
    });
    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        title: 'Test task for plan',
        channelId: 'general',
        type: 'feature',
        assigneeId: 'agent-1',
      },
    });
    taskId = taskRes.json().id;
  });

  it('creates a plan for a task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'Refactor the module',
        steps: [{ description: 'Step 1', verification: 'Test passes', estimatedTools: ['editor'] }],
        risks: [{ description: 'Breaking change', mitigation: 'Compat layer' }],
        filesToModify: ['src/foo.ts'],
      },
    });
    if (res.statusCode !== 201) console.log('CREATE PLAN RESPONSE:', res.json());
    expect(res.statusCode).toBe(201);
    const plan = res.json();
    expect(plan.taskId).toBe(taskId);
    expect(plan.status).toBe('draft');
    expect(plan.approach).toBe('Refactor the module');
    expect(plan.steps).toHaveLength(1);
    expect(plan.risks).toHaveLength(1);
    expect(plan.filesToModify).toEqual(['src/foo.ts']);
  });

  it('rejects creating plan with missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: { approach: 'Do something' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate plan for same task', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'First plan',
        steps: [{ description: 'Step 1', verification: 'Test', estimatedTools: [] }],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'Second plan',
        steps: [{ description: 'Step 2', verification: 'Test', estimatedTools: [] }],
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for plan on non-existent task', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks/nonexistent/plan',
    });
    expect(res.statusCode).toBe(404);
  });

  it('gets a plan after creation', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'My plan',
        steps: [{ description: 'Do it', verification: 'Works', estimatedTools: [] }],
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/plan`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().approach).toBe('My plan');
  });

  it('submits a draft plan', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'My plan',
        steps: [{ description: 'Do it', verification: 'Works', estimatedTools: [] }],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/submit`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('submitted');
  });

  it('rejects submitting non-draft plan', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'My plan',
        steps: [{ description: 'Do it', verification: 'Works', estimatedTools: [] }],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/submit`,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/submit`,
    });
    expect(res.statusCode).toBe(422);
  });

  it('approves a submitted plan', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'My plan',
        steps: [{ description: 'Do it', verification: 'Works', estimatedTools: [] }],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/submit`,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/review`,
      payload: { approved: true, comment: 'LGTM' },
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json();
    expect(plan.status).toBe('approved');
    expect(plan.reviewerApproved).toBe(true);
    expect(plan.reviewerComment).toBe('LGTM');
  });

  it('supports dedicated approve endpoint', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'My plan',
        steps: [{ description: 'Do it', verification: 'Works', estimatedTools: [] }],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/submit`,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/approve`,
      payload: { comment: 'Approved via endpoint' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('approved');
    expect(res.json().reviewerComment).toBe('Approved via endpoint');
  });

  it('rejects a submitted plan', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'My plan',
        steps: [{ description: 'Do it', verification: 'Works', estimatedTools: [] }],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/submit`,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/review`,
      payload: { approved: false, comment: 'Needs more work' },
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json();
    expect(plan.status).toBe('rejected');
    expect(plan.reviewerApproved).toBe(false);
  });

  it('supports dedicated reject endpoint', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'My plan',
        steps: [{ description: 'Do it', verification: 'Works', estimatedTools: [] }],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/submit`,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/reject`,
      payload: { comment: 'Rejected via endpoint' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('rejected');
    expect(res.json().reviewerComment).toBe('Rejected via endpoint');
  });

  it('rejects reviewing non-submitted plan', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan`,
      payload: {
        approach: 'My plan',
        steps: [{ description: 'Do it', verification: 'Works', estimatedTools: [] }],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/plan/review`,
      payload: { approved: true },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('Approval API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetStore();
    app = await buildApp();
  });

  it('creates an approval', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      payload: {
        type: 'task_execution',
        targetId: 'task-1',
        reason: 'P0 task needs approval',
        expiresAt: '2026-06-01T00:00:00Z',
      },
    });
    expect(res.statusCode).toBe(201);
    const approval = res.json();
    expect(approval.type).toBe('task_execution');
    expect(approval.targetId).toBe('task-1');
    expect(approval.status).toBe('pending');
    expect(approval.expiresAt).toBe('2026-06-01T00:00:00Z');
  });

  it('lists approvals', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/approvals',
      payload: { type: 'task_execution', targetId: 'task-1', reason: 'Need approval' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/approvals',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('filters approvals by status', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/approvals',
      payload: { type: 'task_execution', targetId: 'task-1', reason: 'Need approval' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/approvals?status=pending',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/approvals?status=approved',
    });
    expect(res2.json()).toHaveLength(0);
  });

  it('lists pending approvals', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/approvals',
      payload: { type: 'task_execution', targetId: 'task-1', reason: 'Need approval' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/approvals/pending',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('approves a pending approval', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      payload: { type: 'task_execution', targetId: 'task-1', reason: 'Need approval' },
    });
    const approvalId = createRes.json().id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/approve`,
      payload: { comment: 'Looks good' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('approved');
    expect(res.json().comment).toBe('Looks good');
  });

  it('rejects a pending approval', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      payload: { type: 'task_execution', targetId: 'task-1', reason: 'Need approval' },
    });
    const approvalId = createRes.json().id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/reject`,
      payload: { comment: 'Too risky' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('rejected');
  });

  it('rejects approving non-pending approval', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      payload: { type: 'task_execution', targetId: 'task-1', reason: 'Need approval' },
    });
    const approvalId = createRes.json().id;
    await app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/approve`,
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/approvals/${approvalId}/approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 404 for non-existent approval', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/approvals/nonexistent/approve',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('auto-expires overdue approvals', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      payload: {
        type: 'task_execution',
        targetId: 'task-expire',
        reason: 'Will expire',
        expiresAt: '2000-01-01T00:00:00.000Z',
      },
    });
    expect(created.statusCode).toBe(201);
    const expiredCount = await expireDueApprovals(new Date('2000-01-02T00:00:00.000Z'));
    expect(expiredCount).toBe(1);
    const list = await app.inject({ method: 'GET', url: '/api/approvals?status=expired' });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((approval: { targetId: string; status: string }) => approval.targetId === 'task-expire' && approval.status === 'expired')).toBe(true);
  });
});
