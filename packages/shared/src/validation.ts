import { z } from 'zod';

export const RuntimeIdSchema = z.enum(['claude', 'codex', 'gemini', 'opencode', 'pi']);

export const AgentStatusSchema = z.enum(['inactive', 'starting', 'running', 'working', 'idle', 'error']);
export const AgentRoleSchema = z.enum(['unassigned', 'product', 'architect', 'developer', 'qa', 'reviewer', 'security', 'devops', 'documentation', 'coordinator', 'planner']);
export const AgentCapabilitySchema = z.enum(['requirements', 'coding', 'review', 'testing', 'security', 'deployment', 'docs', 'research', 'planning']);
export const AgentWorkingStyleSchema = z.enum(['execution', 'planning', 'reviewing', 'researching']);

export const AgentActivityTypeSchema = z.enum(['thinking', 'working', 'output', 'idle', 'sending', 'error']);
export const ActorTypeSchema = z.enum(['human', 'agent', 'system']);
export const ActorSchema = z.object({
  actorType: ActorTypeSchema,
  actorId: z.string().min(1),
});
export const TaskStatusSchema = z.enum(['backlog', 'spec_needed', 'ready', 'assigned', 'in_progress', 'in_review', 'changes_requested', 'qa', 'done', 'cancelled']);
export const TaskTypeSchema = z.enum(['feature', 'bug', 'chore', 'research', 'docs']);
export const GoalBriefStatusSchema = z.enum(['draft', 'confirmed', 'cancelled', 'completed']);
export const GoalAlignmentStatusSchema = z.enum(['needs_clarification', 'awaiting_confirmation', 'confirmed', 'cancelled']);
export const GoalAlignmentRiskLevelSchema = z.enum(['low', 'medium', 'high']);
export const WorkItemKindSchema = z.enum(['mention', 'dm', 'assigned_task', 'claimable_task', 'reminder', 'review_request', 'blocked_escalation']);
export const WorkItemPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const TaskProgressEventTypeSchema = z.enum(['claimed', 'started', 'heartbeat', 'blocked', 'handoff', 'completed', 'escalated']);
export const ReviewStatusSchema = z.enum(['requested', 'changes_requested', 'approved', 'cancelled']);
export const ReminderStatusSchema = z.enum(['pending', 'triggered', 'cancelled']);
export const KnowledgeKindSchema = z.enum(['decision', 'project_archive', 'user_preference', 'runbook', 'learning', 'artifact']);
export const KnowledgeStatusSchema = z.enum(['active', 'stale', 'conflict', 'archived']);
export const DecisionStatusSchema = z.enum(['proposed', 'accepted', 'deprecated', 'superseded']);
export const DocumentStatusSchema = z.enum(['draft', 'in_review', 'approved', 'deprecated', 'superseded']);
export const DocumentKindSchema = z.enum(['prd', 'tdd', 'adr', 'rfc', 'test_plan', 'runbook', 'postmortem']);

export const MentionSchema = z.object({
  type: z.enum(['agent', 'user']),
  id: z.string(),
  label: z.string(),
});

export const AgentRuntimeConfigSchema = z.object({
  runtime: RuntimeIdSchema,
  model: z.string().optional(),
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  envVars: z.record(z.string()).optional(),
  agentToken: z.string().optional(),
});

export const AgentOrganizationSchema = z.object({
  department: z.string().optional(),
  roles: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  responsibilities: z.array(z.string()).optional(),
  managerId: z.string().optional(),
  backupAgentIds: z.array(z.string()).optional(),
  availability: z.enum(['available', 'unavailable', 'overloaded']).optional(),
}).partial();

export const AgentPermissionsSchema = z.object({
  readChannels: z.array(z.string().min(1)).default([]),
  writeChannels: z.array(z.string().min(1)).default([]),
  createDocs: z.boolean().default(false),
  createTasks: z.boolean().default(true),
  claimTasks: z.boolean().default(true),
  createBranches: z.boolean().default(false),
  createPrs: z.boolean().default(false),
  mergeToMain: z.boolean().default(false),
  deployToProd: z.boolean().default(false),
  accessSensitiveData: z.boolean().default(false),
  callExternalApis: z.array(z.string().min(1)).default([]),
  maxContextTokens: z.number().int().positive().default(100000),
  requiresApprovalFor: z.array(z.string().min(1)).default([]),
});

export const AgentDeliverySchema = z.object({
  id: z.string(),
  channelId: z.string(),
  channelName: z.string(),
  senderName: z.string(),
  content: z.string(),
  threadRootId: z.string().optional(),
  createdAt: z.string(),
});

export const WorkspaceFileSchema = z.object({
  name: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().optional(),
  modifiedAt: z.string().optional(),
});

export const WorkspaceEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('dir'),
    path: z.string(),
    children: z.array(WorkspaceFileSchema),
  }),
  z.object({
    type: z.literal('file'),
    path: z.string(),
    content: z.string(),
    truncated: z.boolean().optional(),
    binary: z.boolean().optional(),
  }),
]);

export const WorkspaceErrorSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
  status: z.number().optional(),
});

export const TaskContextSchema = z.object({
  goalId: z.string().optional(),
  goalObjective: z.string().optional(),
  goal: z.string().optional(),
  background: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  assumptions: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  blockedByTaskIds: z.array(z.string().min(1)).optional(),
  sourceMessageIds: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  requesterAgentId: z.string().optional(),
  previousAgentId: z.string().optional(),
  handoffNotes: z.array(z.string()).optional(),
  privateNotes: z.array(z.string()).optional(),
  claimedByAgentId: z.string().optional(),
  blockedReason: z.string().optional(),
  blockedNeeds: z.string().optional(),
  escalatedReason: z.string().optional(),
  progressEvents: z.array(z.object({
    id: z.string(),
    taskId: z.string(),
    agentId: z.string(),
    type: TaskProgressEventTypeSchema,
    detail: z.string(),
    createdAt: z.string(),
  })).optional(),
  reviewerAgentId: z.string().optional(),
  evidence: z.array(z.string()).optional(),
  acceptanceChecklist: z.array(z.string()).optional(),
  reviewIds: z.array(z.string()).optional(),
  reviewNotes: z.array(z.string()).optional(),
  reviews: z.array(z.object({
    id: z.string(),
    taskId: z.string(),
    requesterAgentId: z.string().optional(),
    reviewerAgentId: z.string().optional(),
    status: ReviewStatusSchema,
    evidence: z.array(z.string()),
    checklist: z.array(z.object({ label: z.string(), checked: z.boolean() })),
    comment: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })).optional(),
  relatedDecisionIds: z.array(z.string().min(1)).optional(),
  relatedDocumentIds: z.array(z.string().min(1)).optional(),
}).partial();

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string(),
  paseoProjectId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const KnowledgeEntrySchema = z.object({
  id: z.string(),
  projectId: z.string().min(1).default('default'),
  kind: KnowledgeKindSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  sourceRefs: z.array(z.string().min(1)).default([]),
  ownerAgentId: z.string().optional(),
  reviewerAgentId: z.string().optional(),
  status: KnowledgeStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateKnowledgeEntryRequestSchema = z.object({
  projectId: z.string().min(1).default('default'),
  kind: KnowledgeKindSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  sourceRefs: z.array(z.string().min(1)).default([]),
  ownerAgentId: z.string().optional(),
  reviewerAgentId: z.string().optional(),
  status: KnowledgeStatusSchema.default('active'),
  allowNoSource: z.boolean().optional(),
});

export const PatchKnowledgeEntryRequestSchema = z.object({
  kind: KnowledgeKindSchema.optional(),
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  sourceRefs: z.array(z.string().min(1)).optional(),
  ownerAgentId: z.string().optional(),
  reviewerAgentId: z.string().optional(),
  status: KnowledgeStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const SearchKnowledgeRequestSchema = z.object({
  query: z.string().optional().default(''),
  kind: KnowledgeKindSchema.optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
}).transform((value) => ({
  ...value,
  tags: typeof value.tag === 'string' ? [value.tag] : value.tag ?? [],
}));

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string().min(1).default('default'),
  channelId: z.string(),
  messageId: z.string().optional(),
  title: z.string(),
  status: TaskStatusSchema,
  type: TaskTypeSchema,
  creatorName: z.string(),
  creator: ActorSchema,
  assigneeId: z.string().optional(),
  owner: ActorSchema.optional(),
  reviewer: ActorSchema.optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  definitionOfDone: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  isBlocked: z.boolean(),
  blockedReason: z.string().optional(),
  sourceChannelId: z.string().optional(),
  sourceThreadId: z.string().optional(),
  context: TaskContextSchema.optional(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MessageSchema = z.object({
  id: z.string(),
  projectId: z.string().min(1).default('default'),
  channelId: z.string(),
  agentId: z.string().optional(),
  actorType: ActorTypeSchema,
  actorId: z.string().min(1),
  senderName: z.string(),
  content: z.string(),
  threadRootId: z.string().optional(),
  replyCount: z.number().int().nonnegative().optional(),
  latestReplyAt: z.string().optional(),
  mentions: z.array(MentionSchema).optional(),
  createdAt: z.string(),
});

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  projectId: z.string().min(1).default('default'),
  actorType: ActorTypeSchema,
  actorId: z.string().min(1),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  detail: z.record(z.unknown()).optional(),
  createdAt: z.string(),
});

export const GoalBriefSchema = z.object({
  id: z.string(),
  projectId: z.string().min(1).default('default'),
  channelId: z.string(),
  sourceMessageId: z.string().optional(),
  requesterName: z.string(),
  objective: z.string(),
  background: z.array(z.string()),
  successCriteria: z.array(z.string()),
  constraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  status: GoalBriefStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ReminderSchema = z.object({
  id: z.string(),
  projectId: z.string().min(1).default('default'),
  agentId: z.string(),
  channelId: z.string(),
  message: z.string(),
  triggerAt: z.string(),
  status: ReminderStatusSchema,
  createdAt: z.string(),
});

export const DaemonToServerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    machineId: z.string().optional(),
    hostname: z.string(),
    os: z.string(),
    daemonVersion: z.string(),
    runtimes: z.array(RuntimeIdSchema),
    runtimeVersions: z.record(z.string()),
    runningAgents: z.array(z.string()),
    capabilities: z.array(z.string()),
  }),
  z.object({ type: z.literal('pong') }),
  z.object({
    type: z.literal('agent:status'),
    agentId: z.string(),
    status: AgentStatusSchema,
    launchId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:activity'),
    agentId: z.string(),
    activityType: AgentActivityTypeSchema,
    detail: z.string().optional(),
    launchId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:session'),
    agentId: z.string(),
    sessionId: z.string(),
    launchId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:dm'),
    fromAgentId: z.string(),
    toAgentId: z.string(),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('agent:delegate'),
    fromAgentId: z.string().min(1),
    toAgentId: z.string().min(1),
    content: z.string().min(1),
    startIfInactive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('agent:create_task'),
    agentId: z.string(),
    title: z.string().min(1),
    channelId: z.string().optional(),
    assigneeId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:update_task'),
    agentId: z.string(),
    taskId: z.string(),
    status: TaskStatusSchema,
  }),
  z.object({
    type: z.literal('agent:set_reminder'),
    agentId: z.string(),
    channelId: z.string().optional(),
    message: z.string().min(1),
    triggerAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal('agent:cancel_reminder'),
    agentId: z.string(),
    reminderId: z.string().min(1),
  }),
  z.object({
    type: z.literal('agent:message'),
    agentId: z.string(),
    channelId: z.string(),
    content: z.string(),
    inReplyToMessageId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent:deliver:ack'),
    agentId: z.string(),
    seq: z.number(),
  }),
  z.object({
    type: z.literal('workspace:result'),
    requestId: z.string(),
    result: z.union([WorkspaceEntrySchema, WorkspaceErrorSchema]),
  }),
  z.object({
    type: z.literal('machine:runtime_models:result'),
    requestId: z.string(),
    models: z.array(z.string()).optional(),
    default: z.string().optional(),
    error: z.string().optional(),
  }),
]);

export const CreateAgentRequestSchema = z.object({
  projectId: z.string().min(1).default('default'),
  name: z.string().min(1),
  runtime: RuntimeIdSchema,
  displayName: z.string().optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  machineId: z.string().optional(),
  envVars: z.record(z.string()).optional(),
  role: AgentRoleSchema.optional(),
  responsibilities: z.array(z.string().min(1)).optional(),
  capabilities: z.array(AgentCapabilitySchema).optional(),
  workingStyle: AgentWorkingStyleSchema.optional(),
  handoffPreference: z.string().optional(),
  constraints: z.array(z.string().min(1)).optional(),
  examples: z.array(z.string().min(1)).optional(),
  permissions: AgentPermissionsSchema.optional(),
  organization: AgentOrganizationSchema.optional(),
});

export const PatchAgentRequestSchema = z
  .object({
    runtime: RuntimeIdSchema.optional(),
    machineId: z.string().optional(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    autoStart: z.boolean().optional(),
    envVars: z.record(z.string()).optional(),
    role: AgentRoleSchema.optional(),
    responsibilities: z.array(z.string().min(1)).optional(),
    capabilities: z.array(AgentCapabilitySchema).optional(),
    workingStyle: AgentWorkingStyleSchema.optional(),
    handoffPreference: z.string().optional(),
    constraints: z.array(z.string().min(1)).optional(),
    examples: z.array(z.string().min(1)).optional(),
    permissions: AgentPermissionsSchema.optional(),
    organization: AgentOrganizationSchema.optional(),
  })
  .refine(
    (val) =>
      val.machineId !== undefined ||
      val.runtime !== undefined ||
      val.displayName !== undefined ||
      val.description !== undefined ||
      val.model !== undefined ||
      val.systemPrompt !== undefined ||
      val.autoStart !== undefined ||
      val.envVars !== undefined ||
      val.role !== undefined ||
      val.responsibilities !== undefined ||
      val.capabilities !== undefined ||
      val.workingStyle !== undefined ||
      val.handoffPreference !== undefined ||
      val.constraints !== undefined ||
      val.examples !== undefined ||
      val.permissions !== undefined ||
      val.organization !== undefined,
    { message: 'At least one field must be provided' },
  );

export const CreateMessageRequestSchema = z.object({
  senderName: z.string().min(1),
  content: z.string().min(1),
  agentId: z.string().optional(),
  actorType: ActorTypeSchema.optional(),
  actorId: z.string().min(1).optional(),
  threadRootId: z.string().optional(),
});

export const CreateChannelRequestSchema = z.object({
  projectId: z.string().min(1).default('default'),
  name: z.string().trim().min(1).max(80).refine((value) => !/[\r\n\t]/.test(value), 'Channel name cannot contain control characters'),
});

export const SearchRequestSchema = z.object({
  q: z.string().trim().min(1),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const CreateDirectMessageRequestSchema = z.object({
  content: z.string().min(1),
  fromAgentId: z.string().optional(),
});

export const CreateAgentDelegationRequestSchema = z.object({
  content: z.string().min(1),
  startIfInactive: z.boolean().optional(),
});

export const CreateTaskRequestSchema = z.object({
  projectId: z.string().min(1).default('default'),
  channelId: z.string().min(1).default('general'),
  messageId: z.string().optional(),
  title: z.string().min(1).max(200),
  status: TaskStatusSchema.default('backlog'),
  type: TaskTypeSchema.default('feature'),
  creatorName: z.string().min(1).default('user'),
  creatorType: ActorTypeSchema.default('human'),
  creatorId: z.string().min(1).optional(),
  assigneeId: z.string().optional(),
  ownerType: ActorTypeSchema.optional(),
  ownerId: z.string().min(1).optional(),
  reviewerType: ActorTypeSchema.optional(),
  reviewerId: z.string().min(1).optional(),
  acceptanceCriteria: z.array(z.string().min(1)).optional(),
  definitionOfDone: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  isBlocked: z.boolean().default(false),
  blockedReason: z.string().optional(),
  sourceChannelId: z.string().optional(),
  sourceThreadId: z.string().optional(),
  context: TaskContextSchema.optional(),
});

export const PatchTaskRequestSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    assigneeId: z.string().optional(),
    ownerType: ActorTypeSchema.optional(),
    ownerId: z.string().min(1).optional(),
    reviewerType: ActorTypeSchema.optional(),
    reviewerId: z.string().min(1).optional(),
    acceptanceCriteria: z.array(z.string().min(1)).optional(),
    definitionOfDone: z.array(z.string().min(1)).optional(),
    constraints: z.array(z.string().min(1)).optional(),
    dependsOn: z.array(z.string().min(1)).optional(),
    isBlocked: z.boolean().optional(),
    blockedReason: z.string().optional(),
    context: TaskContextSchema.optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine((val) => Object.entries(val).some(([key, value]) => key !== 'expectedVersion' && value !== undefined), {
    message: 'At least one field must be provided',
  });

export const CreateReminderRequestSchema = z.object({
  projectId: z.string().min(1).default('default'),
  channelId: z.string().min(1).default('general'),
  message: z.string().min(1),
  triggerAt: z.string().datetime(),
});

export const PatchReminderRequestSchema = z.object({
  status: z.literal('cancelled'),
});

export const MessageToTaskRequestSchema = z.object({
  assigneeId: z.string().optional(),
  creatorName: z.string().min(1).default('user'),
  creatorType: ActorTypeSchema.default('human'),
  creatorId: z.string().min(1).optional(),
  context: TaskContextSchema.optional(),
});

const GoalTextArraySchema = z.array(z.string().min(1)).default([]);

export const CreateGoalBriefRequestSchema = z.object({
  projectId: z.string().min(1).default('default'),
  channelId: z.string().min(1).default('general'),
  sourceMessageId: z.string().optional(),
  requesterName: z.string().min(1).default('user'),
  objective: z.string().min(1),
  background: GoalTextArraySchema,
  successCriteria: GoalTextArraySchema,
  constraints: GoalTextArraySchema,
  assumptions: GoalTextArraySchema,
  risks: GoalTextArraySchema,
  status: GoalBriefStatusSchema.default('draft'),
});

export const PatchGoalBriefRequestSchema = z
  .object({
    objective: z.string().min(1).optional(),
    background: z.array(z.string().min(1)).optional(),
    successCriteria: z.array(z.string().min(1)).optional(),
    constraints: z.array(z.string().min(1)).optional(),
    assumptions: z.array(z.string().min(1)).optional(),
    risks: z.array(z.string().min(1)).optional(),
    status: GoalBriefStatusSchema.optional(),
  })
  .refine((val) => Object.values(val).some((value) => value !== undefined), {
    message: 'At least one field must be provided',
  });

export const MessageToGoalBriefRequestSchema = z.object({
  requesterName: z.string().min(1).default('user'),
  objective: z.string().min(1).optional(),
  background: z.array(z.string().min(1)).default([]),
  successCriteria: z.array(z.string().min(1)).default([]),
  constraints: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
});

export const GoalTaskDraftSchema = z.object({
  title: z.string().min(1).max(200),
  assigneeId: z.string().optional(),
  dependencies: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  artifacts: z.array(z.string().min(1)).default([]),
});

export const GoalAlignmentTaskDraftSchema = GoalTaskDraftSchema.extend({
  role: z.enum(['owner', 'reviewer', 'support']).optional(),
});

export const GoalAlignmentSchema = z.object({
  id: z.string(),
  projectId: z.string().min(1).default('default'),
  channelId: z.string(),
  threadRootId: z.string(),
  sourceMessageId: z.string(),
  goalId: z.string().optional(),
  status: GoalAlignmentStatusSchema,
  objective: z.string(),
  questions: z.array(z.string()),
  answers: z.array(z.string()),
  successCriteria: z.array(z.string()),
  constraints: z.array(z.string()),
  planSummary: z.string().optional(),
  taskDrafts: z.array(GoalAlignmentTaskDraftSchema),
  recommendedAgentIds: z.array(z.string()),
  reviewerAgentIds: z.array(z.string()),
  recommendationReasons: z.record(z.string()),
  gaps: z.array(z.string()),
  riskLevel: GoalAlignmentRiskLevelSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const DecisionParticipantSchema = z.object({
  actorType: ActorTypeSchema,
  actorId: z.string().min(1),
  role: z.string().optional(),
});

export const DecisionSchema = z.object({
  id: z.string(),
  projectId: z.string().min(1).default('default'),
  channelId: z.string(),
  sourceThreadId: z.string().optional(),
  title: z.string().min(1),
  status: DecisionStatusSchema,
  problem: z.string().min(1),
  alternatives: z.array(z.string().min(1)).optional(),
  decisionText: z.string().min(1),
  rationale: z.string().optional(),
  consequences: z.array(z.string().min(1)).optional(),
  participants: z.array(DecisionParticipantSchema).optional(),
  relatedDecisions: z.array(z.string().min(1)).optional(),
  supersededBy: z.string().optional(),
  acceptedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateDecisionRequestSchema = z.object({
  projectId: z.string().min(1).default('default'),
  channelId: z.string().min(1),
  sourceThreadId: z.string().optional(),
  title: z.string().min(1).max(200),
  status: DecisionStatusSchema.default('proposed'),
  problem: z.string().min(1),
  alternatives: z.array(z.string().min(1)).default([]),
  decisionText: z.string().min(1),
  rationale: z.string().optional(),
  consequences: z.array(z.string().min(1)).default([]),
  participants: z.array(DecisionParticipantSchema).default([]),
  relatedDecisions: z.array(z.string().min(1)).default([]),
});

export const PatchDecisionRequestSchema = z
  .object({
    status: DecisionStatusSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    problem: z.string().min(1).optional(),
    alternatives: z.array(z.string().min(1)).optional(),
    decisionText: z.string().min(1).optional(),
    rationale: z.string().optional(),
    consequences: z.array(z.string().min(1)).optional(),
    participants: z.array(DecisionParticipantSchema).optional(),
    relatedDecisions: z.array(z.string().min(1)).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided',
  });

export const DecisionTransitionRequestSchema = z.object({
  supersededBy: z.string().min(1).optional(),
});

export const DocumentReviewerSchema = z.object({
  actorType: ActorTypeSchema,
  actorId: z.string().min(1),
});

export const DocumentSchema = z.object({
  id: z.string(),
  projectId: z.string().min(1).default('default'),
  kind: DocumentKindSchema,
  title: z.string().min(1),
  status: DocumentStatusSchema,
  content: z.string(),
  sourceThreadId: z.string().optional(),
  sourceChannelId: z.string(),
  author: ActorSchema,
  authorName: z.string().min(1),
  reviewers: z.array(DocumentReviewerSchema).optional(),
  relatedDecisions: z.array(z.string().min(1)).optional(),
  relatedTasks: z.array(z.string().min(1)).optional(),
  supersededBy: z.string().optional(),
  approvedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateDocumentRequestSchema = z.object({
  projectId: z.string().min(1).default('default'),
  kind: DocumentKindSchema,
  title: z.string().min(1).max(200),
  content: z.string().default(''),
  sourceThreadId: z.string().optional(),
  sourceChannelId: z.string().min(1),
  authorType: ActorTypeSchema.default('human'),
  authorId: z.string().min(1),
  authorName: z.string().min(1),
  relatedDecisions: z.array(z.string().min(1)).default([]),
  relatedTasks: z.array(z.string().min(1)).default([]),
});

export const PatchDocumentRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().optional(),
    relatedDecisions: z.array(z.string().min(1)).optional(),
    relatedTasks: z.array(z.string().min(1)).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided',
  });

export const SubmitDocumentReviewRequestSchema = z.object({
  reviewers: z.array(DocumentReviewerSchema).min(1),
});

export const ApproveDocumentRequestSchema = z.object({
  actorType: ActorTypeSchema,
  actorId: z.string().min(1),
});

export const CreateGoalTasksRequestSchema = z.object({
  creatorName: z.string().min(1).default('user'),
  tasks: z.array(GoalTaskDraftSchema).min(1),
});

export const StartGoalAlignmentRequestSchema = z.object({
  requesterName: z.string().min(1).default('user'),
  objective: z.string().min(1).optional(),
});

export const PatchGoalAlignmentRequestSchema = z
  .object({
    status: GoalAlignmentStatusSchema.optional(),
    objective: z.string().min(1).optional(),
    questions: z.array(z.string().min(1)).optional(),
    answers: z.array(z.string().min(1)).optional(),
    successCriteria: z.array(z.string().min(1)).optional(),
    constraints: z.array(z.string().min(1)).optional(),
    planSummary: z.string().min(1).optional(),
    taskDrafts: z.array(GoalAlignmentTaskDraftSchema).optional(),
    recommendedAgentIds: z.array(z.string()).optional(),
    reviewerAgentIds: z.array(z.string()).optional(),
    recommendationReasons: z.record(z.string()).optional(),
    gaps: z.array(z.string()).optional(),
    riskLevel: GoalAlignmentRiskLevelSchema.optional(),
  })
  .refine((val) => Object.values(val).some((value) => value !== undefined), {
    message: 'At least one field must be provided',
  });

export const ConfirmGoalAlignmentRequestSchema = z.object({
  requesterName: z.string().min(1).default('user'),
});

export const InternalMessageSendRequestSchema = z.object({
  channel: z.string().min(1).default('general'),
  content: z.string().min(1),
  threadRootId: z.string().optional(),
});

export const InternalMessageReadRequestSchema = z.object({
  channel: z.string().min(1).default('general'),
  limit: z.coerce.number().int().positive().max(200).default(20),
});

export const InternalDmSendRequestSchema = z.object({
  to: z.string().min(1),
  content: z.string().min(1),
});

export const InternalAgentDelegateRequestSchema = z.object({
  to: z.string().min(1),
  content: z.string().min(1),
  startIfInactive: z.boolean().optional(),
});

export const InternalAgentResolveRequestSchema = z
  .object({
    query: z.string().min(1).optional(),
    role: AgentRoleSchema.optional(),
    capabilities: z.union([AgentCapabilitySchema, z.array(AgentCapabilitySchema)]).optional(),
    excludeAgentId: z.string().min(1).optional(),
    mustBeIdle: z.preprocess((value) => {
      if (value === undefined) return undefined;
      if (value === true || value === 'true' || value === '1') return true;
      if (value === false || value === 'false' || value === '0') return false;
      return value;
    }, z.boolean()).optional(),
    maxResults: z.coerce.number().int().positive().max(50).optional(),
  })
  .transform((value) => ({
    ...value,
    capabilities: typeof value.capabilities === 'string' ? [value.capabilities] : value.capabilities,
  }))
  .refine((value) => Boolean(value.query || value.role || (value.capabilities && value.capabilities.length > 0)), {
    message: 'At least one of query, role, or capabilities is required',
  });

export const InternalTaskListRequestSchema = z.object({
  channel: z.string().min(1).optional(),
  status: TaskStatusSchema.optional(),
  all: z.preprocess((value) => {
    if (value === undefined) return false;
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  }, z.boolean()).default(false),
});

export const InternalTaskCreateRequestSchema = z.object({
  channel: z.string().min(1).default('general'),
  title: z.string().min(1).max(200),
  creatorName: z.string().min(1).default('user'),
  assigneeId: z.string().optional(),
  status: TaskStatusSchema.default('backlog'),
  type: TaskTypeSchema.default('feature'),
  context: TaskContextSchema.optional(),
  messageId: z.string().optional(),
});

export const InternalTaskUpdateRequestSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    assigneeId: z.string().optional(),
    isBlocked: z.boolean().optional(),
    blockedReason: z.string().optional(),
    context: TaskContextSchema.optional(),
  })
  .refine((val) => val.status !== undefined || val.assigneeId !== undefined || val.isBlocked !== undefined || val.blockedReason !== undefined || val.context !== undefined, {
    message: 'At least one field must be provided',
  });

export const InternalTaskHandoffRequestSchema = z.object({
  to: z.string().min(1),
  notes: z.string().min(1),
  goal: z.string().optional(),
  nextStep: z.string().optional(),
});

export const InternalInboxRequestSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const InternalTaskProgressRequestSchema = z.object({
  detail: z.string().min(1),
});

export const InternalTaskBlockRequestSchema = z.object({
  reason: z.string().min(1),
  needs: z.string().min(1),
});

export const InternalTaskEscalateRequestSchema = z.object({
  reason: z.string().min(1),
});

export const CreateTaskReviewRequestSchema = z.object({
  requesterAgentId: z.string().optional(),
  reviewerAgentId: z.string().optional(),
  evidence: z.array(z.string().min(1)).default([]),
  checklist: z.array(z.union([z.string().min(1), z.object({ label: z.string().min(1), checked: z.boolean().default(false) })])).default([]),
  comment: z.string().optional(),
  allowSelfReview: z.boolean().optional(),
  selfReviewReason: z.string().optional(),
});

export const ReviewDecisionRequestSchema = z.object({
  reviewerAgentId: z.string().optional(),
  comment: z.string().min(1),
});

export const InternalReviewListRequestSchema = z.object({
  all: z.preprocess((value) => {
    if (value === undefined) return false;
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  }, z.boolean()).default(false),
});

export const InternalGoalListRequestSchema = z.object({
  channel: z.string().min(1).optional(),
  status: GoalBriefStatusSchema.optional(),
});

export const InternalChannelCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).refine((value) => !/[\r\n\t]/.test(value), 'Channel name cannot contain control characters'),
});

export const InternalGoalCreateRequestSchema = z.object({
  projectId: z.string().min(1).default('default'),
  channel: z.string().min(1).default('general'),
  objective: z.string().min(1),
  background: z.array(z.string().min(1)).default([]),
  successCriteria: z.array(z.string().min(1)).default([]),
  constraints: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
});

export const InternalGoalCreateTasksRequestSchema = CreateGoalTasksRequestSchema;
export const InternalGoalAlignRequestSchema = StartGoalAlignmentRequestSchema;
export const InternalGoalAlignmentPatchRequestSchema = PatchGoalAlignmentRequestSchema;

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().default(''),
  paseoProjectId: z.string().optional(),
});

export const PatchProjectRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z.string().optional(),
    paseoProjectId: z.string().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided',
  });

export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type PatchAgentRequest = z.infer<typeof PatchAgentRequestSchema>;
export type CreateMessageRequest = z.infer<typeof CreateMessageRequestSchema>;
export type CreateDirectMessageRequest = z.infer<typeof CreateDirectMessageRequestSchema>;
export type CreateAgentDelegationRequest = z.infer<typeof CreateAgentDelegationRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type PatchTaskRequest = z.infer<typeof PatchTaskRequestSchema>;
export type MessageToTaskRequest = z.infer<typeof MessageToTaskRequestSchema>;
export type CreateGoalBriefRequest = z.infer<typeof CreateGoalBriefRequestSchema>;
export type PatchGoalBriefRequest = z.infer<typeof PatchGoalBriefRequestSchema>;
export type MessageToGoalBriefRequest = z.infer<typeof MessageToGoalBriefRequestSchema>;
export type CreateGoalTasksRequest = z.infer<typeof CreateGoalTasksRequestSchema>;
export type StartGoalAlignmentRequest = z.infer<typeof StartGoalAlignmentRequestSchema>;
export type PatchGoalAlignmentRequest = z.infer<typeof PatchGoalAlignmentRequestSchema>;
export type ConfirmGoalAlignmentRequest = z.infer<typeof ConfirmGoalAlignmentRequestSchema>;
export type CreateDecisionRequest = z.infer<typeof CreateDecisionRequestSchema>;
export type PatchDecisionRequest = z.infer<typeof PatchDecisionRequestSchema>;
export type DecisionTransitionRequest = z.infer<typeof DecisionTransitionRequestSchema>;
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;
export type PatchDocumentRequest = z.infer<typeof PatchDocumentRequestSchema>;
export type SubmitDocumentReviewRequest = z.infer<typeof SubmitDocumentReviewRequestSchema>;
export type ApproveDocumentRequest = z.infer<typeof ApproveDocumentRequestSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type PatchProjectRequest = z.infer<typeof PatchProjectRequestSchema>;
export type TaskContextRequest = z.infer<typeof TaskContextSchema>;
export type InternalMessageSendRequest = z.infer<typeof InternalMessageSendRequestSchema>;
export type InternalMessageReadRequest = z.infer<typeof InternalMessageReadRequestSchema>;
export type InternalDmSendRequest = z.infer<typeof InternalDmSendRequestSchema>;
export type InternalAgentDelegateRequest = z.infer<typeof InternalAgentDelegateRequestSchema>;
export type InternalAgentResolveRequest = z.infer<typeof InternalAgentResolveRequestSchema>;
export type InternalTaskListRequest = z.infer<typeof InternalTaskListRequestSchema>;
export type InternalTaskCreateRequest = z.infer<typeof InternalTaskCreateRequestSchema>;
export type InternalTaskUpdateRequest = z.infer<typeof InternalTaskUpdateRequestSchema>;
export type InternalTaskHandoffRequest = z.infer<typeof InternalTaskHandoffRequestSchema>;
export type InternalInboxRequest = z.infer<typeof InternalInboxRequestSchema>;
export type InternalTaskProgressRequest = z.infer<typeof InternalTaskProgressRequestSchema>;
export type InternalTaskBlockRequest = z.infer<typeof InternalTaskBlockRequestSchema>;
export type InternalTaskEscalateRequest = z.infer<typeof InternalTaskEscalateRequestSchema>;
export type CreateTaskReviewRequest = z.infer<typeof CreateTaskReviewRequestSchema>;
export type ReviewDecisionRequest = z.infer<typeof ReviewDecisionRequestSchema>;
export type InternalReviewListRequest = z.infer<typeof InternalReviewListRequestSchema>;
export type CreateKnowledgeEntryRequest = z.infer<typeof CreateKnowledgeEntryRequestSchema>;
export type PatchKnowledgeEntryRequest = z.infer<typeof PatchKnowledgeEntryRequestSchema>;
export type SearchKnowledgeRequest = z.infer<typeof SearchKnowledgeRequestSchema>;
export type InternalGoalListRequest = z.infer<typeof InternalGoalListRequestSchema>;
export type InternalChannelCreateRequest = z.infer<typeof InternalChannelCreateRequestSchema>;
export type InternalGoalCreateRequest = z.infer<typeof InternalGoalCreateRequestSchema>;
export type InternalGoalCreateTasksRequest = z.infer<typeof InternalGoalCreateTasksRequestSchema>;
export type InternalGoalAlignRequest = z.infer<typeof InternalGoalAlignRequestSchema>;
export type InternalGoalAlignmentPatchRequest = z.infer<typeof InternalGoalAlignmentPatchRequestSchema>;

export const ServerToDaemonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('agent:start'),
    agentId: z.string(),
    config: AgentRuntimeConfigSchema,
    launchId: z.string(),
    wakeMessage: AgentDeliverySchema.optional(),
    inboxSummary: z.string().optional(),
  }),
  z.object({ type: z.literal('agent:stop'), agentId: z.string() }),
  z.object({
    type: z.literal('agent:deliver'),
    agentId: z.string(),
    seq: z.number(),
    message: AgentDeliverySchema,
    config: AgentRuntimeConfigSchema.optional(),
    channelId: z.string().optional(),
    inboxSummary: z.string().optional(),
  }),
  z.object({ type: z.literal('agent:reset-workspace'), agentId: z.string() }),
  z.object({
    type: z.literal('workspace:read'),
    agentId: z.string(),
    requestId: z.string(),
    relPath: z.string(),
  }),
  z.object({
    type: z.literal('machine:runtime_models:detect'),
    runtime: RuntimeIdSchema,
    requestId: z.string(),
  }),
]);
