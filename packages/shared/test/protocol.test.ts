import { describe, it, expect } from 'vitest';
import {
  DaemonToServerSchema,
  ServerToDaemonSchema,
  RuntimeIdSchema,
  CreateAgentRequestSchema,
  PatchAgentRequestSchema,
  CreateChannelRequestSchema,
  CreateMessageRequestSchema,
  CreateDirectMessageRequestSchema,
  CreateAgentDelegationRequestSchema,
  CreateTaskRequestSchema,
  CreateGoalBriefRequestSchema,
  CreateGoalTasksRequestSchema,
  GoalAlignmentSchema,
  GoalBriefSchema,
  PatchGoalAlignmentRequestSchema,
  InternalAgentResolveRequestSchema,
  InternalAgentDelegateRequestSchema,
  InternalDmSendRequestSchema,
  InternalMessageReadRequestSchema,
  InternalMessageSendRequestSchema,
  InternalInboxRequestSchema,
  InternalTaskBlockRequestSchema,
  InternalTaskEscalateRequestSchema,
  InternalTaskHandoffRequestSchema,
  InternalTaskListRequestSchema,
  InternalTaskProgressRequestSchema,
  InternalTaskUpdateRequestSchema,
  InternalGoalCreateRequestSchema,
  InternalGoalCreateTasksRequestSchema,
  InternalGoalListRequestSchema,
  MessageToGoalBriefRequestSchema,
  MessageToTaskRequestSchema,
  PatchGoalBriefRequestSchema,
  CreateKnowledgeEntryRequestSchema,
  PatchKnowledgeEntryRequestSchema,
  SearchKnowledgeRequestSchema,
  CreateDecisionRequestSchema,
  PatchDecisionRequestSchema,
  CreateDocumentRequestSchema,
  PatchDocumentRequestSchema,
  SubmitDocumentReviewRequestSchema,
  ApproveDocumentRequestSchema,
  PatchTaskRequestSchema,
  MessageSchema,
  AuditLogEntrySchema,
  StartGoalAlignmentRequestSchema,
  TaskSchema,
  AgentPermissionsSchema,
  ContextPackageSchema,
  PlanSchema,
  ApprovalSchema,
  CreatePlanRequestSchema,
  CreateApprovalRequestSchema,
  ReviewPlanRequestSchema,
  RespondApprovalRequestSchema,
} from '../src/validation.js';
import { APP_VERSION, createVersionInfo } from '../src/version.js';

describe('DaemonToServer protocol', () => {
  it('parses a valid ready message', () => {
    const msg = {
      type: 'ready',
      hostname: 'my-machine',
      os: 'darwin',
      daemonVersion: '0.1.0',
      runtimes: ['claude', 'gemini'],
      runtimeVersions: { claude: '1.0.0' },
      runningAgents: [],
      capabilities: [],
    };
    const result = DaemonToServerSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('ready');
    }
  });

  it('parses agent:message', () => {
    const msg = {
      type: 'agent:message',
      agentId: 'agent-1',
      channelId: 'channel-1',
      content: 'Hello world',
    };
    const result = DaemonToServerSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses agent:status', () => {
    const msg = {
      type: 'agent:status',
      agentId: 'agent-1',
      status: 'running',
    };
    const result = DaemonToServerSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses workspace:result', () => {
    const result = DaemonToServerSchema.safeParse({
      type: 'workspace:result',
      requestId: 'workspace-1',
      result: {
        type: 'dir',
        path: '',
        children: [{ name: 'transcript.txt', type: 'file', size: 12 }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('parses agent:activity', () => {
    const msg = {
      type: 'agent:activity',
      agentId: 'agent-1',
      activityType: 'sending',
      detail: 'channel:general',
    };
    const result = DaemonToServerSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('agent:activity');
      expect(result.data.activityType).toBe('sending');
    }
  });

  it('rejects unknown agent activity types', () => {
    const result = DaemonToServerSchema.safeParse({
      type: 'agent:activity',
      agentId: 'agent-1',
      activityType: 'planning',
    });
    expect(result.success).toBe(false);
  });

  it('parses agent:dm', () => {
    const result = DaemonToServerSchema.safeParse({
      type: 'agent:dm',
      fromAgentId: 'agent-1',
      toAgentId: 'agent-2',
      content: 'private hello',
    });
    expect(result.success).toBe(true);
  });

  it('parses agent:delegate', () => {
    const result = DaemonToServerSchema.safeParse({
      type: 'agent:delegate',
      fromAgentId: 'agent-1',
      toAgentId: 'agent-2',
      content: 'please handle this',
      startIfInactive: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid agent:delegate payloads', () => {
    expect(DaemonToServerSchema.safeParse({ type: 'agent:delegate', fromAgentId: 'a', toAgentId: '', content: 'x' }).success).toBe(false);
    expect(DaemonToServerSchema.safeParse({ type: 'agent:delegate', fromAgentId: 'a', toAgentId: 'b', content: '' }).success).toBe(false);
  });

  it('parses agent task events', () => {
    expect(DaemonToServerSchema.safeParse({
      type: 'agent:create_task',
      agentId: 'agent-1',
      title: 'write tests',
      channelId: 'general',
      assigneeId: 'agent-2',
    }).success).toBe(true);
    expect(DaemonToServerSchema.safeParse({
      type: 'agent:update_task',
      agentId: 'agent-1',
      taskId: 'task-1',
      status: 'in_review',
    }).success).toBe(true);
  });
});

describe('ServerToDaemon protocol', () => {
  it('parses agent:start', () => {
    const msg = {
      type: 'agent:start',
      agentId: 'agent-1',
      config: {
        runtime: 'claude',
        name: 'my-agent',
        agentToken: 'token-1',
      },
      launchId: 'launch-1',
      inboxSummary: 'Open tasks assigned to you:\n- task-1 [todo] #general: write tests',
    };
    const result = ServerToDaemonSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses agent:deliver', () => {
    const msg = {
      type: 'agent:deliver',
      agentId: 'agent-1',
      seq: 1,
      message: {
        id: 'msg-1',
        channelId: 'ch-1',
        channelName: 'general',
        senderName: 'user',
        content: 'Hello',
        threadRootId: 'root-1',
        createdAt: new Date().toISOString(),
      },
      inboxSummary: 'Claimable unassigned tasks matching your role/capability:\n- task-2 [todo] #general: fix bug',
    };
    const result = ServerToDaemonSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('parses ping', () => {
    const result = ServerToDaemonSchema.safeParse({ type: 'ping' });
    expect(result.success).toBe(true);
  });

  it('parses workspace:read', () => {
    const result = ServerToDaemonSchema.safeParse({
      type: 'workspace:read',
      agentId: 'agent-1',
      requestId: 'workspace-1',
      relPath: 'transcript.txt',
    });
    expect(result.success).toBe(true);
  });
});

describe('Internal agent API schemas', () => {
  it('accepts agent-facing CLI request bodies', () => {
    expect(InternalMessageSendRequestSchema.safeParse({ channel: 'general', content: 'hello', threadRootId: 'root-1' }).success).toBe(true);
    expect(InternalMessageReadRequestSchema.safeParse({ channel: 'general', limit: '10' }).success).toBe(true);
    expect(InternalDmSendRequestSchema.safeParse({ to: 'agent-2', content: 'secret' }).success).toBe(true);
    expect(InternalAgentResolveRequestSchema.safeParse({ query: '产品经理' }).success).toBe(true);
    expect(InternalAgentResolveRequestSchema.safeParse({ role: 'developer', capabilities: 'coding', mustBeIdle: 'true', maxResults: '5' }).success).toBe(true);
    expect(InternalAgentDelegateRequestSchema.safeParse({ to: 'agent-2', content: 'work', startIfInactive: true }).success).toBe(true);
    expect(InternalTaskListRequestSchema.safeParse({ status: 'backlog', all: 'true' }).success).toBe(true);
    expect(InternalTaskUpdateRequestSchema.safeParse({ status: 'in_progress' }).success).toBe(true);
    expect(InternalInboxRequestSchema.safeParse({ limit: '10' }).success).toBe(true);
    expect(InternalTaskProgressRequestSchema.safeParse({ detail: 'still working' }).success).toBe(true);
    expect(InternalTaskBlockRequestSchema.safeParse({ reason: 'missing input', needs: 'user decision' }).success).toBe(true);
    expect(InternalTaskEscalateRequestSchema.safeParse({ reason: 'blocked too long' }).success).toBe(true);
    expect(InternalGoalListRequestSchema.safeParse({ channel: 'general', status: 'draft' }).success).toBe(true);
    expect(InternalGoalCreateRequestSchema.safeParse({ objective: 'ship v1.1', successCriteria: ['tasks have context'] }).success).toBe(true);
    expect(InternalGoalCreateTasksRequestSchema.safeParse({ tasks: [{ title: 'write plan' }] }).success).toBe(true);
  });

  it('rejects empty internal agent API content', () => {
    expect(InternalMessageSendRequestSchema.safeParse({ channel: 'general', content: '' }).success).toBe(false);
    expect(InternalDmSendRequestSchema.safeParse({ to: 'agent-2', content: '' }).success).toBe(false);
    expect(InternalAgentResolveRequestSchema.safeParse({ query: '' }).success).toBe(false);
    expect(InternalAgentResolveRequestSchema.safeParse({}).success).toBe(false);
    expect(InternalAgentDelegateRequestSchema.safeParse({ to: '', content: 'work' }).success).toBe(false);
    expect(InternalTaskUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(InternalGoalCreateRequestSchema.safeParse({ objective: '' }).success).toBe(false);
  });
});

describe('Agent patch schemas', () => {
  it('accepts runtime updates and still rejects empty or invalid runtime patches', () => {
    expect(PatchAgentRequestSchema.safeParse({ runtime: 'codex' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ runtime: 'gpt4' }).success).toBe(false);
    expect(PatchAgentRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts identity v2 profile and permission fields', () => {
    expect(CreateAgentRequestSchema.safeParse({
      name: 'dev-agent',
      runtime: 'codex',
      role: 'developer',
      capabilities: ['coding', 'review'],
      responsibilities: ['ship v2.1 api'],
      workingStyle: 'execution',
      handoffPreference: 'handoff via thread summary',
      constraints: ['no prod deploy'],
      examples: ['api owner'],
      permissions: {
        writeChannels: ['general'],
        createTasks: true,
      },
    }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({
      role: 'qa',
      capabilities: ['testing'],
      permissions: { createDocs: true },
    }).success).toBe(true);
  });
});

describe('Agent permission schema', () => {
  it('applies defaults', () => {
    const parsed = AgentPermissionsSchema.parse({ writeChannels: ['general'], createTasks: false });
    expect(parsed.writeChannels).toEqual(['general']);
    expect(parsed.createTasks).toBe(false);
    expect(parsed.claimTasks).toBe(true);
    expect(parsed.maxContextTokens).toBe(100000);
  });
});

describe('Decision/Document schemas', () => {
  it('accepts decision create/patch payloads', () => {
    expect(CreateDecisionRequestSchema.safeParse({
      channelId: 'general',
      title: 'Use ADR',
      problem: 'Need durable decision history',
      decisionText: 'Adopt ADR documents',
    }).success).toBe(true);
    expect(PatchDecisionRequestSchema.safeParse({ status: 'accepted' }).success).toBe(true);
    expect(PatchDecisionRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts document lifecycle payloads', () => {
    expect(CreateDocumentRequestSchema.safeParse({
      kind: 'prd',
      title: 'Roadmap',
      sourceChannelId: 'general',
      authorType: 'human',
      authorId: 'user',
      authorName: 'user',
    }).success).toBe(true);
    expect(PatchDocumentRequestSchema.safeParse({ content: '# Update' }).success).toBe(true);
    expect(SubmitDocumentReviewRequestSchema.safeParse({ reviewers: [{ actorType: 'agent', actorId: 'qa' }] }).success).toBe(true);
    expect(ApproveDocumentRequestSchema.safeParse({ actorType: 'human', actorId: 'user' }).success).toBe(true);
  });
});

describe('RuntimeId validation', () => {
  it('accepts valid runtimes', () => {
    expect(RuntimeIdSchema.safeParse('claude').success).toBe(true);
    expect(RuntimeIdSchema.safeParse('codex').success).toBe(true);
    expect(RuntimeIdSchema.safeParse('gemini').success).toBe(true);
    expect(RuntimeIdSchema.safeParse('opencode').success).toBe(true);
    expect(RuntimeIdSchema.safeParse('pi').success).toBe(true);
  });

  it('rejects invalid runtime', () => {
    expect(RuntimeIdSchema.safeParse('gpt4').success).toBe(false);
    expect(RuntimeIdSchema.safeParse('').success).toBe(false);
  });
});

describe('CreateAgentRequestSchema', () => {
  it('accepts minimal valid body', () => {
    const result = CreateAgentRequestSchema.safeParse({ name: 'a', runtime: 'claude' });
    expect(result.success).toBe(true);
  });

  it('accepts body with all optional fields', () => {
    const result = CreateAgentRequestSchema.safeParse({
      name: 'a',
      runtime: 'claude',
      displayName: 'A',
      description: 'desc',
      model: 'sonnet',
      systemPrompt: 'be helpful',
      machineId: 'm-1',
      envVars: { FOO: 'bar' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(CreateAgentRequestSchema.safeParse({ name: '', runtime: 'claude' }).success).toBe(false);
  });

  it('rejects missing runtime', () => {
    expect(CreateAgentRequestSchema.safeParse({ name: 'a' }).success).toBe(false);
  });

  it('rejects invalid runtime', () => {
    expect(CreateAgentRequestSchema.safeParse({ name: 'a', runtime: 'gpt4' }).success).toBe(false);
  });
});

describe('CreateChannelRequestSchema', () => {
  it('accepts display-oriented channel names', () => {
    const result = CreateChannelRequestSchema.safeParse({ name: '  产品 讨论  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('产品 讨论');
  });

  it('rejects empty and control-character channel names', () => {
    expect(CreateChannelRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateChannelRequestSchema.safeParse({ name: 'ops\nteam' }).success).toBe(false);
  });
});

describe('PatchAgentRequestSchema', () => {
  it('accepts single field update', () => {
    expect(PatchAgentRequestSchema.safeParse({ displayName: 'New' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ machineId: 'm-2' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ description: 'desc' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ model: 'sonnet' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ systemPrompt: 'sp' }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ autoStart: true }).success).toBe(true);
    expect(PatchAgentRequestSchema.safeParse({ envVars: { A: 'B' } }).success).toBe(true);
  });

  it('rejects empty body', () => {
    expect(PatchAgentRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('CreateDirectMessageRequestSchema', () => {
  it('accepts a direct message body', () => {
    expect(CreateDirectMessageRequestSchema.safeParse({ content: 'hello' }).success).toBe(true);
    expect(CreateDirectMessageRequestSchema.safeParse({ fromAgentId: 'user', content: 'hello' }).success).toBe(true);
  });

  it('rejects empty content', () => {
    expect(CreateDirectMessageRequestSchema.safeParse({ content: '' }).success).toBe(false);
  });
});

describe('CreateAgentDelegationRequestSchema', () => {
  it('accepts a delegation body', () => {
    expect(CreateAgentDelegationRequestSchema.safeParse({ content: 'do this' }).success).toBe(true);
    expect(CreateAgentDelegationRequestSchema.safeParse({ content: 'do this', startIfInactive: false }).success).toBe(true);
  });

  it('rejects empty content', () => {
    expect(CreateAgentDelegationRequestSchema.safeParse({ content: '' }).success).toBe(false);
  });
});

describe('Task schemas', () => {
  it('accepts task objects and request bodies', () => {
    expect(TaskSchema.safeParse({
      id: 'task-1',
      channelId: 'general',
      title: 'ship board',
      status: 'backlog',
      type: 'feature',
      creatorName: 'user',
      creator: { actorType: 'human', actorId: 'user' },
      isBlocked: false,
      context: {
        goal: 'ship context',
        acceptanceCriteria: ['passes tests'],
        handoffNotes: ['from agent: continue here'],
        blockedReason: 'missing input',
        progressEvents: [{ id: 'evt-1', taskId: 'task-1', agentId: 'agent-1', type: 'heartbeat', detail: 'working', createdAt: new Date().toISOString() }],
      },
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).success).toBe(true);
    expect(CreateTaskRequestSchema.safeParse({ title: 'ship board', context: { goal: 'ship board' } }).success).toBe(true);
    expect(PatchTaskRequestSchema.safeParse({ status: 'done', context: { artifacts: ['docs/v0.6-task-board.md'] } }).success).toBe(true);
    expect(MessageToTaskRequestSchema.safeParse({ creatorName: 'user' }).success).toBe(true);
    expect(InternalTaskHandoffRequestSchema.safeParse({ to: 'agent-2', notes: 'done with analysis', nextStep: 'write tests' }).success).toBe(true);
  });

  it('accepts blocked task status and rejects empty patches', () => {
    expect(PatchTaskRequestSchema.safeParse({ isBlocked: true, blockedReason: 'missing input' }).success).toBe(true);
    expect(PatchTaskRequestSchema.safeParse({ status: 'changes_requested' }).success).toBe(true);
    expect(PatchTaskRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts polymorphic message actors and audit entries', () => {
    const now = new Date().toISOString();
    expect(MessageSchema.safeParse({
      id: 'msg-1',
      channelId: 'general',
      actorType: 'agent',
      actorId: 'agent-1',
      senderName: 'Agent One',
      content: 'done',
      createdAt: now,
    }).success).toBe(true);
    expect(AuditLogEntrySchema.safeParse({
      id: 'audit-1',
      actorType: 'system',
      actorId: 'crewden',
      action: 'task.status_changed',
      entityType: 'task',
      entityId: 'task-1',
      detail: { from: 'assigned', to: 'in_progress' },
      createdAt: now,
    }).success).toBe(true);
  });
});

describe('Goal schemas', () => {
  it('accepts goal objects and request bodies', () => {
    const now = new Date().toISOString();
    expect(GoalBriefSchema.safeParse({
      id: 'goal-1',
      channelId: 'general',
      sourceMessageId: 'msg-1',
      requesterName: 'user',
      objective: 'Ship v1.1',
      background: ['User wants agent company workflow'],
      successCriteria: ['Goal creates contextual tasks'],
      constraints: ['Do not deploy to production'],
      assumptions: ['Agents use CLI'],
      risks: ['Scope may grow'],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }).success).toBe(true);
    expect(CreateGoalBriefRequestSchema.safeParse({ objective: 'Ship v1.1' }).success).toBe(true);
    expect(PatchGoalBriefRequestSchema.safeParse({ status: 'confirmed' }).success).toBe(true);
    expect(MessageToGoalBriefRequestSchema.safeParse({ successCriteria: ['ready for agents'] }).success).toBe(true);
    expect(CreateGoalTasksRequestSchema.safeParse({
      tasks: [{ title: 'write implementation plan', dependencies: ['goal confirmed'], acceptanceCriteria: ['task context is complete'] }],
    }).success).toBe(true);
  });

  it('rejects invalid goal bodies', () => {
    expect(CreateGoalBriefRequestSchema.safeParse({ objective: '' }).success).toBe(false);
    expect(PatchGoalBriefRequestSchema.safeParse({}).success).toBe(false);
    expect(CreateGoalTasksRequestSchema.safeParse({ tasks: [] }).success).toBe(false);
  });

  it('accepts goal alignment objects and request bodies', () => {
    const now = new Date().toISOString();
    expect(StartGoalAlignmentRequestSchema.parse({}).requesterName).toBe('user');
    expect(PatchGoalAlignmentRequestSchema.parse({ answers: ['Ship MVP first'] }).answers).toEqual(['Ship MVP first']);
    expect(GoalAlignmentSchema.parse({
      id: 'align-1',
      channelId: 'general',
      threadRootId: 'msg-1',
      sourceMessageId: 'msg-1',
      status: 'awaiting_confirmation',
      objective: 'Ship v1.2',
      questions: [],
      answers: [],
      successCriteria: ['Plan is actionable'],
      constraints: [],
      taskDrafts: [{ title: 'Draft product plan', role: 'owner' }],
      recommendedAgentIds: ['pm'],
      reviewerAgentIds: ['qa'],
      recommendationReasons: { pm: 'Matches product planning.' },
      gaps: [],
      riskLevel: 'low',
      createdAt: now,
      updatedAt: now,
    }).taskDrafts[0].role).toBe('owner');
  });

  it('accepts knowledge entry request bodies and filters', () => {
    const created = CreateKnowledgeEntryRequestSchema.parse({
      kind: 'decision',
      title: 'Use v1 test environment',
      summary: 'v1 work uses the test Cloudflare instance.',
      body: 'Keep main and production isolated until V1 is accepted.',
      tags: ['v1', 'cloudflare'],
      sourceRefs: ['goal:v1'],
    });
    expect(created.status).toBe('active');
    expect(PatchKnowledgeEntryRequestSchema.safeParse({ status: 'stale' }).success).toBe(true);
    expect(PatchKnowledgeEntryRequestSchema.safeParse({}).success).toBe(false);
    expect(SearchKnowledgeRequestSchema.parse({ query: 'test env', kind: 'decision', tag: 'v1' }).tags).toEqual(['v1']);
  });
});

describe('CreateMessageRequestSchema', () => {
  it('accepts valid message', () => {
    const result = CreateMessageRequestSchema.safeParse({ senderName: 'u', content: 'hi' });
    expect(result.success).toBe(true);
  });

  it('accepts message with agentId', () => {
    const result = CreateMessageRequestSchema.safeParse({
      senderName: 'u',
      content: 'hi',
      agentId: 'a-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a message with thread root metadata', () => {
    const result = CreateMessageRequestSchema.safeParse({
      senderName: 'u',
      content: '@产品经理 please review',
      threadRootId: 'msg-root',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty senderName', () => {
    expect(
      CreateMessageRequestSchema.safeParse({ senderName: '', content: 'hi' }).success,
    ).toBe(false);
  });

  it('rejects empty content', () => {
    expect(
      CreateMessageRequestSchema.safeParse({ senderName: 'u', content: '' }).success,
    ).toBe(false);
  });
});

describe('version info', () => {
  it('uses the shared app version by default', () => {
    expect(createVersionInfo('daemon')).toEqual({ component: 'daemon', version: APP_VERSION });
  });

  it('keeps injected build metadata', () => {
    expect(createVersionInfo('web', { version: 'abc123', commit: 'abc123', build: '42' })).toEqual({
      component: 'web',
      version: 'abc123',
      commit: 'abc123',
      build: '42',
    });
  });
});

describe('ContextPackage staleness fields', () => {
  const baseCp = {
    taskId: 'task-1',
    generatedAt: new Date().toISOString(),
    sections: [],
    totalTokens: 0,
    agentMaxTokens: 100000,
    truncationApplied: false,
  };

  it('accepts ContextPackage without staleness fields', () => {
    expect(ContextPackageSchema.safeParse(baseCp).success).toBe(true);
  });

  it('accepts ContextPackage with stale=true and staleReason', () => {
    const result = ContextPackageSchema.safeParse({
      ...baseCp,
      stale: true,
      staleReason: 'document updated: doc-1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stale).toBe(true);
      expect(result.data.staleReason).toBe('document updated: doc-1');
    }
  });

  it('accepts ContextPackage with dataSourcesUpdatedAt', () => {
    const result = ContextPackageSchema.safeParse({
      ...baseCp,
      stale: false,
      dataSourcesUpdatedAt: {
        taskUpdatedAt: '2026-05-01T00:00:00Z',
        decisionsUpdatedAt: '2026-05-02T00:00:00Z',
        documentsUpdatedAt: '2026-05-03T00:00:00Z',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dataSourcesUpdatedAt?.taskUpdatedAt).toBe('2026-05-01T00:00:00Z');
    }
  });

  it('accepts stale=false without staleReason', () => {
    const result = ContextPackageSchema.safeParse({
      ...baseCp,
      stale: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stale).toBe(false);
      expect(result.data.staleReason).toBeUndefined();
    }
  });
});

describe('Plan schema', () => {
  const basePlan = {
    id: 'plan-1',
    taskId: 'task-1',
    status: 'draft',
    approach: 'Refactor the module',
    steps: [
      { description: 'Step 1', verification: 'Test passes', estimatedTools: ['editor'] },
    ],
    authorType: 'agent' as const,
    authorId: 'agent-1',
    createdAt: '2026-05-10T00:00:00Z',
    updatedAt: '2026-05-10T00:00:00Z',
  };

  it('validates a minimal plan', () => {
    const result = PlanSchema.safeParse(basePlan);
    expect(result.success).toBe(true);
  });

  it('validates a full plan with optional fields', () => {
    const result = PlanSchema.safeParse({
      ...basePlan,
      projectId: 'proj-1',
      risks: [{ description: 'Breaking change', mitigation: 'Add backward compat' }],
      filesToModify: ['src/foo.ts'],
      filesToCreate: ['src/bar.ts'],
      testsToAdd: ['test/bar.test.ts'],
      reviewerType: 'agent',
      reviewerId: 'reviewer-1',
      reviewerApproved: true,
      reviewerComment: 'LGTM',
    });
    expect(result.success).toBe(true);
  });

  it('rejects plan with empty approach', () => {
    const result = PlanSchema.safeParse({ ...basePlan, approach: '' });
    expect(result.success).toBe(false);
  });

  it('rejects plan with no steps', () => {
    const result = PlanSchema.safeParse({ ...basePlan, steps: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid plan status', () => {
    const result = PlanSchema.safeParse({ ...basePlan, status: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('CreatePlanRequestSchema validates correctly', () => {
    const result = CreatePlanRequestSchema.safeParse({
      approach: 'Do the thing',
      steps: [{ description: 'Step 1', verification: 'Passes', estimatedTools: [] }],
    });
    expect(result.success).toBe(true);
  });

  it('ReviewPlanRequestSchema validates approve', () => {
    const result = ReviewPlanRequestSchema.safeParse({ approved: true, comment: 'Looks good' });
    expect(result.success).toBe(true);
  });

  it('ReviewPlanRequestSchema validates reject without comment', () => {
    const result = ReviewPlanRequestSchema.safeParse({ approved: false });
    expect(result.success).toBe(true);
  });
});

describe('Approval schema', () => {
  const baseApproval = {
    id: 'approval-1',
    type: 'task_execution' as const,
    targetId: 'task-1',
    status: 'pending',
    requestedByType: 'agent' as const,
    requestedById: 'agent-1',
    reason: 'P0 task requires human approval',
    requestedAt: '2026-05-10T00:00:00Z',
  };

  it('validates a minimal approval', () => {
    const result = ApprovalSchema.safeParse(baseApproval);
    expect(result.success).toBe(true);
  });

  it('validates a full approval with response', () => {
    const result = ApprovalSchema.safeParse({
      ...baseApproval,
      projectId: 'proj-1',
      approvedByType: 'human',
      approvedById: 'user-1',
      context: 'Additional context',
      respondedAt: '2026-05-10T01:00:00Z',
      expiresAt: '2026-05-11T00:00:00Z',
      comment: 'Approved after review',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid approval type', () => {
    const result = ApprovalSchema.safeParse({ ...baseApproval, type: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid approval status', () => {
    const result = ApprovalSchema.safeParse({ ...baseApproval, status: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('CreateApprovalRequestSchema validates correctly', () => {
    const result = CreateApprovalRequestSchema.safeParse({
      type: 'deploy_production',
      targetId: 'task-1',
      reason: 'Production deployment',
      expiresAt: '2026-05-12T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('RespondApprovalRequestSchema validates with comment', () => {
    const result = RespondApprovalRequestSchema.safeParse({ comment: 'Rejected due to risk' });
    expect(result.success).toBe(true);
  });

  it('RespondApprovalRequestSchema validates without comment', () => {
    const result = RespondApprovalRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
