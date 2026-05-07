import { describe, expect, it } from 'vitest';
import { buildContextPackage, estimateTokens } from '../src/contextPackageBuilder.js';
import type { ContextPackageDataSources } from '../src/contextPackageBuilder.js';
import type { Task, Decision, Document, Agent, AgentPermissions } from '@crewden/shared';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    channelId: 'general',
    title: 'Implement auth flow',
    status: 'assigned',
    type: 'feature',
    creatorName: 'user',
    creator: { actorType: 'human', actorId: 'user' },
    isBlocked: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSources(overrides: Partial<ContextPackageDataSources> = {}): ContextPackageDataSources {
  return {
    getDecision: async () => undefined,
    getDocument: async () => undefined,
    getThreadSummary: async () => undefined,
    getTask: async () => undefined,
    getAgent: async () => undefined,
    getAgentPermissions: async () => undefined,
    ...overrides,
  };
}

describe('estimateTokens', () => {
  it('estimates English text tokens', () => {
    const result = estimateTokens('Hello world this is a test');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10);
  });

  it('estimates CJK text tokens', () => {
    const result = estimateTokens('你好世界这是一个测试');
    expect(result).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens([])).toBe(0);
  });

  it('handles mixed content', () => {
    const result = estimateTokens(['Hello', '你好']);
    expect(result).toBeGreaterThan(0);
  });
});

describe('buildContextPackage', () => {
  it('includes task definition and constraints for minimal task', async () => {
    const task = makeTask({
      acceptanceCriteria: ['Must work', 'Must be secure'],
    });
    const pkg = await buildContextPackage(task, 'agent-1', makeSources());

    expect(pkg.taskId).toBe('task-1');
    expect(pkg.sections.length).toBeGreaterThanOrEqual(1);
    expect(pkg.sections[0].source).toBe('task');
    expect(pkg.sections[0].title).toContain('Implement auth flow');
    expect(pkg.sections[0].priority).toBe(1);
    expect(pkg.truncationApplied).toBe(false);
    expect(pkg.agentMaxTokens).toBe(100000);
  });

  it('includes constraints section when criteria exist', async () => {
    const task = makeTask({
      constraints: ['No external deps'],
      acceptanceCriteria: ['All tests pass'],
    });
    const pkg = await buildContextPackage(task, 'agent-1', makeSources());

    const constraintSection = pkg.sections.find((s) => s.title === 'Constraints & Acceptance Criteria');
    expect(constraintSection).toBeDefined();
    expect(constraintSection!.priority).toBe(2);
    expect(constraintSection!.content).toContain('No external deps');
    expect(constraintSection!.content).toContain('All tests pass');
  });

  it('includes decision sections', async () => {
    const decision: Decision = {
      id: 'dec-1',
      channelId: 'general',
      title: 'Use JWT tokens',
      status: 'accepted',
      problem: 'Need auth mechanism',
      decisionText: 'Use JWT with RS256',
      rationale: 'Industry standard',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const task = makeTask({
      context: { relatedDecisionIds: ['dec-1'] },
    });
    const pkg = await buildContextPackage(task, 'agent-1', makeSources({
      getDecision: async (id) => id === 'dec-1' ? decision : undefined,
    }));

    const decisionSection = pkg.sections.find((s) => s.source === 'decision');
    expect(decisionSection).toBeDefined();
    expect(decisionSection!.title).toContain('Use JWT tokens');
    expect(decisionSection!.content).toContain('Need auth mechanism');
    expect(decisionSection!.content).toContain('Use JWT with RS256');
    expect(decisionSection!.priority).toBe(3);
  });

  it('includes document sections', async () => {
    const doc: Document = {
      id: 'doc-1',
      kind: 'prd',
      title: 'Auth PRD',
      status: 'approved',
      content: 'This is the PRD content for authentication flow.',
      sourceChannelId: 'general',
      author: { actorType: 'human', actorId: 'user' },
      authorName: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const task = makeTask({
      context: { relatedDocumentIds: ['doc-1'] },
    });
    const pkg = await buildContextPackage(task, 'agent-1', makeSources({
      getDocument: async (id) => id === 'doc-1' ? doc : undefined,
    }));

    const docSection = pkg.sections.find((s) => s.source === 'document');
    expect(docSection).toBeDefined();
    expect(docSection!.title).toContain('Auth PRD');
    expect(docSection!.priority).toBe(3);
  });

  it('includes thread summary when task has source thread', async () => {
    const task = makeTask({ sourceThreadId: 'thread-1' });
    const pkg = await buildContextPackage(task, 'agent-1', makeSources({
      getThreadSummary: async (id) => id === 'thread-1'
        ? { summaryContent: 'Discussion about auth approach', title: 'Auth Discussion' }
        : undefined,
    }));

    const threadSection = pkg.sections.find((s) => s.source === 'thread_summary');
    expect(threadSection).toBeDefined();
    expect(threadSection!.content).toContain('Discussion about auth approach');
    expect(threadSection!.priority).toBe(4);
  });

  it('includes parent task results from dependencies', async () => {
    const parentTask = makeTask({
      id: 'parent-1',
      title: 'Setup project structure',
      context: {
        progressEvents: [{
          id: 'evt-1', taskId: 'parent-1', agentId: 'agent-1',
          type: 'completed', detail: 'Project structure created with auth module',
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    });
    const task = makeTask({ dependsOn: ['parent-1'] });
    const pkg = await buildContextPackage(task, 'agent-1', makeSources({
      getTask: async (id) => id === 'parent-1' ? parentTask : undefined,
    }));

    const parentSection = pkg.sections.find((s) => s.source === 'parent_task_result');
    expect(parentSection).toBeDefined();
    expect(parentSection!.title).toContain('Setup project structure');
    expect(parentSection!.content).toContain('Project structure created');
    expect(parentSection!.priority).toBe(5);
  });

  it('sorts sections by priority', async () => {
    const task = makeTask({
      sourceThreadId: 'thread-1',
      dependsOn: ['parent-1'],
      context: {
        relatedDecisionIds: ['dec-1'],
        relatedDocumentIds: ['doc-1'],
      },
    });
    const sources = makeSources({
      getDecision: async () => ({
        id: 'dec-1', channelId: 'general', title: 'D', status: 'accepted',
        problem: 'p', decisionText: 'd', createdAt: '', updatedAt: '',
      }),
      getDocument: async () => ({
        id: 'doc-1', kind: 'prd' as const, title: 'Doc', status: 'draft',
        content: 'content', sourceChannelId: 'general',
        author: { actorType: 'human', actorId: 'u' }, authorName: 'u',
        createdAt: '', updatedAt: '',
      }),
      getThreadSummary: async () => ({ summaryContent: 'summary', title: 'T' }),
      getTask: async () => makeTask({
        context: { progressEvents: [{ id: 'e', taskId: 'parent-1', agentId: 'a', type: 'completed', detail: 'done', createdAt: '' }] },
      }),
    });

    const pkg = await buildContextPackage(task, 'agent-1', sources);
    for (let i = 1; i < pkg.sections.length; i++) {
      expect(pkg.sections[i].priority).toBeGreaterThanOrEqual(pkg.sections[i - 1].priority);
    }
  });

  it('truncates low priority sections when exceeding budget', async () => {
    const task = makeTask({
      context: { relatedDecisionIds: ['dec-1'] },
    });
    const longContent = 'A'.repeat(50000);
    const sources = makeSources({
      getAgentPermissions: async () => ({
        readChannels: [], writeChannels: [], createDocs: false, createTasks: true,
        claimTasks: true, createBranches: false, createPrs: false, mergeToMain: false,
        deployToProd: false, accessSensitiveData: false, callExternalApis: [],
        maxContextTokens: 200, requiresApprovalFor: [],
      } satisfies AgentPermissions),
      getDecision: async () => ({
        id: 'dec-1', channelId: 'general', title: 'Big Decision', status: 'accepted',
        problem: longContent, decisionText: longContent, createdAt: '', updatedAt: '',
      }),
    });

    const pkg = await buildContextPackage(task, 'agent-1', sources);
    expect(pkg.truncationApplied).toBe(true);
    expect(pkg.totalTokens).toBeLessThanOrEqual(pkg.agentMaxTokens);
  });

  it('uses agent permissions for maxContextTokens', async () => {
    const task = makeTask();
    const sources = makeSources({
      getAgentPermissions: async () => ({
        readChannels: [], writeChannels: [], createDocs: false, createTasks: true,
        claimTasks: true, createBranches: false, createPrs: false, mergeToMain: false,
        deployToProd: false, accessSensitiveData: false, callExternalApis: [],
        maxContextTokens: 50000, requiresApprovalFor: [],
      } satisfies AgentPermissions),
    });

    const pkg = await buildContextPackage(task, 'agent-1', sources);
    expect(pkg.agentMaxTokens).toBe(50000);
  });

  it('generates a valid timestamp', async () => {
    const before = new Date().toISOString();
    const pkg = await buildContextPackage(makeTask(), 'agent-1', makeSources());
    const after = new Date().toISOString();
    expect(pkg.generatedAt >= before).toBe(true);
    expect(pkg.generatedAt <= after).toBe(true);
  });
});
