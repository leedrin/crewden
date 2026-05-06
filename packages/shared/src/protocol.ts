import type { VersionInfo } from './version.js';

export type RuntimeId = 'claude' | 'codex' | 'gemini' | 'opencode' | 'pi';

export type AgentStatus = 'inactive' | 'starting' | 'running' | 'working' | 'idle' | 'error';
export type AgentRole =
  | 'unassigned'
  | 'product'
  | 'architect'
  | 'developer'
  | 'qa'
  | 'reviewer'
  | 'security'
  | 'devops'
  | 'documentation'
  | 'coordinator'
  | 'planner';
export type AgentCapability = 'requirements' | 'coding' | 'review' | 'testing' | 'security' | 'deployment' | 'docs' | 'research' | 'planning';
export type AgentWorkingStyle = 'execution' | 'planning' | 'reviewing' | 'researching';
export type AgentPermissions = {
  readChannels: string[];
  writeChannels: string[];
  createDocs: boolean;
  createTasks: boolean;
  claimTasks: boolean;
  createBranches: boolean;
  createPrs: boolean;
  mergeToMain: boolean;
  deployToProd: boolean;
  accessSensitiveData: boolean;
  callExternalApis: string[];
  maxContextTokens: number;
  requiresApprovalFor: string[];
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  description: string;
  paseoProjectId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentActivity = {
  id: string;
  agentId: string;
  type: 'thinking' | 'working' | 'output' | 'idle' | 'sending' | 'error';
  detail?: string;
  createdAt: string;
};

export type AgentRuntimeConfig = {
  runtime: RuntimeId;
  model?: string;
  name: string;
  displayName?: string;
  description?: string;
  systemPrompt?: string;
  envVars?: Record<string, string>;
  agentToken?: string;
};

export type DirectMessage = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  createdAt: string;
};

export type DirectMessageThread = {
  otherAgentId: string;
  lastMessage: DirectMessage;
};

export type AgentDelegation = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  status: 'queued' | 'delivered' | 'started' | 'failed';
  error?: string;
  createdAt: string;
};

export type ActorType = 'human' | 'agent' | 'system';
export type Actor = {
  actorType: ActorType;
  actorId: string;
};

export type TaskStatus =
  | 'backlog'
  | 'spec_needed'
  | 'ready'
  | 'assigned'
  | 'in_progress'
  | 'in_review'
  | 'changes_requested'
  | 'qa'
  | 'done'
  | 'cancelled';
export type TaskType = 'feature' | 'bug' | 'chore' | 'research' | 'docs';
export type GoalBriefStatus = 'draft' | 'confirmed' | 'cancelled' | 'completed';
export type GoalAlignmentStatus = 'needs_clarification' | 'awaiting_confirmation' | 'confirmed' | 'cancelled';
export type GoalAlignmentRiskLevel = 'low' | 'medium' | 'high';
export type WorkItemKind = 'mention' | 'dm' | 'assigned_task' | 'claimable_task' | 'reminder' | 'review_request' | 'blocked_escalation';
export type WorkItemPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskProgressEventType = 'claimed' | 'started' | 'heartbeat' | 'blocked' | 'handoff' | 'completed' | 'escalated';
export type ReviewStatus = 'requested' | 'changes_requested' | 'approved' | 'cancelled';
export type KnowledgeKind = 'decision' | 'project_archive' | 'user_preference' | 'runbook' | 'learning' | 'artifact';
export type KnowledgeStatus = 'active' | 'stale' | 'conflict' | 'archived';
export type DecisionStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';
export type DocumentStatus = 'draft' | 'in_review' | 'approved' | 'deprecated' | 'superseded';
export type DocumentKind = 'prd' | 'tdd' | 'adr' | 'rfc' | 'test_plan' | 'runbook' | 'postmortem';

export type AgentInboxItem = {
  id: string;
  kind: WorkItemKind;
  agentId: string;
  channelId?: string;
  messageId?: string;
  taskId?: string;
  goalId?: string;
  priority: WorkItemPriority;
  summary: string;
  dueAt?: string;
  createdAt: string;
};

export type TaskProgressEvent = {
  id: string;
  taskId: string;
  agentId: string;
  type: TaskProgressEventType;
  detail: string;
  createdAt: string;
};

export type TaskReview = {
  id: string;
  taskId: string;
  requesterAgentId?: string;
  reviewerAgentId?: string;
  status: ReviewStatus;
  evidence: string[];
  checklist: Array<{ label: string; checked: boolean }>;
  comment?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeEntry = {
  id: string;
  projectId?: string;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  sourceRefs: string[];
  ownerAgentId?: string;
  reviewerAgentId?: string;
  status: KnowledgeStatus;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSearchResult = {
  entry: KnowledgeEntry;
  score?: number;
  reason?: string;
};

export type KnowledgeAdapter = {
  id: string;
  name: string;
  search(query: string, options?: { tags?: string[]; kind?: KnowledgeKind }): Promise<KnowledgeSearchResult[]>;
  read(id: string): Promise<KnowledgeEntry | undefined>;
  write(entry: KnowledgeEntry): Promise<KnowledgeEntry>;
  update(id: string, patch: Partial<KnowledgeEntry>): Promise<KnowledgeEntry>;
};

export type GoalBrief = {
  id: string;
  projectId?: string;
  channelId: string;
  sourceMessageId?: string;
  requesterName: string;
  objective: string;
  background: string[];
  successCriteria: string[];
  constraints: string[];
  assumptions: string[];
  risks: string[];
  status: GoalBriefStatus;
  createdAt: string;
  updatedAt: string;
};

export type GoalTaskDraft = {
  title: string;
  assigneeId?: string;
  dependencies?: string[];
  acceptanceCriteria?: string[];
  artifacts?: string[];
};

export type GoalAlignmentTaskDraft = GoalTaskDraft & {
  role?: 'owner' | 'reviewer' | 'support';
};

export type GoalAlignment = {
  id: string;
  projectId?: string;
  channelId: string;
  threadRootId: string;
  sourceMessageId: string;
  goalId?: string;
  status: GoalAlignmentStatus;
  objective: string;
  questions: string[];
  answers: string[];
  successCriteria: string[];
  constraints: string[];
  planSummary?: string;
  taskDrafts: GoalAlignmentTaskDraft[];
  recommendedAgentIds: string[];
  reviewerAgentIds: string[];
  recommendationReasons: Record<string, string>;
  gaps: string[];
  riskLevel: GoalAlignmentRiskLevel;
  createdAt: string;
  updatedAt: string;
};

export type TaskContext = {
  goalId?: string;
  goalObjective?: string;
  goal?: string;
  background?: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  assumptions?: string[];
  risks?: string[];
  dependencies?: string[];
  blockedByTaskIds?: string[];
  sourceMessageIds?: string[];
  artifacts?: string[];
  requesterAgentId?: string;
  previousAgentId?: string;
  handoffNotes?: string[];
  privateNotes?: string[];
  claimedByAgentId?: string;
  blockedReason?: string;
  blockedNeeds?: string;
  escalatedReason?: string;
  progressEvents?: TaskProgressEvent[];
  reviewerAgentId?: string;
  evidence?: string[];
  acceptanceChecklist?: string[];
  reviewIds?: string[];
  reviewNotes?: string[];
  reviews?: TaskReview[];
  relatedDecisionIds?: string[];
  relatedDocumentIds?: string[];
};

export type Task = {
  id: string;
  projectId?: string;
  channelId: string;
  messageId?: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  creatorName: string;
  creator: Actor;
  assigneeId?: string;
  owner?: Actor;
  reviewer?: Actor;
  acceptanceCriteria?: string[];
  definitionOfDone?: string[];
  constraints?: string[];
  dependsOn?: string[];
  isBlocked: boolean;
  blockedReason?: string;
  sourceChannelId?: string;
  sourceThreadId?: string;
  context?: TaskContext;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AuditLogEntry = {
  id: string;
  projectId?: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
  createdAt: string;
};

export type DecisionParticipant = {
  actorType: ActorType;
  actorId: string;
  role?: string;
};

export type Decision = {
  id: string;
  projectId?: string;
  channelId: string;
  sourceThreadId?: string;
  title: string;
  status: DecisionStatus;
  problem: string;
  alternatives?: string[];
  decisionText: string;
  rationale?: string;
  consequences?: string[];
  participants?: DecisionParticipant[];
  relatedDecisions?: string[];
  supersededBy?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentReviewer = {
  actorType: ActorType;
  actorId: string;
};

export type Document = {
  id: string;
  projectId?: string;
  kind: DocumentKind;
  title: string;
  status: DocumentStatus;
  content: string;
  sourceThreadId?: string;
  sourceChannelId: string;
  author: Actor;
  authorName: string;
  reviewers?: DocumentReviewer[];
  relatedDecisions?: string[];
  relatedTasks?: string[];
  supersededBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReminderStatus = 'pending' | 'triggered' | 'cancelled';

export type Reminder = {
  id: string;
  projectId?: string;
  agentId: string;
  channelId: string;
  message: string;
  triggerAt: string;
  status: ReminderStatus;
  createdAt: string;
};

export type AgentTokenInfo = {
  agentId: string;
  token: string;
  createdAt: string;
};

export type AgentWhoami = {
  agent: Agent;
};

export type AgentResolveResult = {
  query: string;
  match?: Agent;
  confidence?: 'exact_id' | 'exact_name' | 'exact_display_name' | 'case_insensitive_name' | 'case_insensitive_display_name' | 'description_hint';
  candidates: Agent[];
};

export type AgentServerInfo = {
  agent: Agent;
  channels: Channel[];
  agents: Agent[];
  version: VersionInfo;
};

export type AgentUnreadSummary = {
  channels: Array<{ channelId: string; channelName: string; count: number; latestMessage?: Message }>;
  dms: Array<{ otherAgentId: string; count: number; latestMessage?: DirectMessage }>;
};

export type AgentDelivery = {
  id: string;
  channelId: string;
  channelName: string;
  senderName: string;
  content: string;
  threadRootId?: string;
  createdAt: string;
};

export type WorkspaceFile = {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: string;
};

export type WorkspaceEntry =
  | { type: 'dir'; path: string; children: WorkspaceFile[] }
  | { type: 'file'; path: string; content: string; truncated?: boolean; binary?: boolean };

export type WorkspaceError = {
  type: 'error';
  error: string;
  status?: number;
};

export type DaemonToServer =
  | {
      type: 'ready';
      machineId?: string;
      hostname: string;
      os: string;
      daemonVersion: string;
      runtimes: RuntimeId[];
      runtimeVersions: Record<string, string>;
      runningAgents: string[];
      capabilities: string[];
    }
  | { type: 'pong' }
  | { type: 'agent:status'; agentId: string; status: AgentStatus; launchId?: string }
  | { type: 'agent:activity'; agentId: string; activityType: AgentActivity['type']; detail?: string; launchId?: string }
  | { type: 'agent:session'; agentId: string; sessionId: string; launchId?: string }
  | { type: 'agent:dm'; fromAgentId: string; toAgentId: string; content: string }
  | { type: 'agent:delegate'; fromAgentId: string; toAgentId: string; content: string; startIfInactive?: boolean }
  | { type: 'agent:create_task'; agentId: string; title: string; channelId?: string; assigneeId?: string }
  | { type: 'agent:update_task'; agentId: string; taskId: string; status: TaskStatus }
  | { type: 'agent:set_reminder'; agentId: string; channelId?: string; message: string; triggerAt: string }
  | { type: 'agent:cancel_reminder'; agentId: string; reminderId: string }
  | { type: 'agent:message'; agentId: string; channelId: string; content: string; inReplyToMessageId?: string }
  | { type: 'agent:deliver:ack'; agentId: string; seq: number }
  | { type: 'workspace:result'; requestId: string; result: WorkspaceEntry | WorkspaceError }
  | { type: 'machine:runtime_models:result'; requestId: string; models?: string[]; default?: string; error?: string };

export type ServerToDaemon =
  | { type: 'ping' }
  | { type: 'agent:start'; agentId: string; config: AgentRuntimeConfig; launchId: string; wakeMessage?: AgentDelivery; inboxSummary?: string }
  | { type: 'agent:stop'; agentId: string }
  | { type: 'agent:deliver'; agentId: string; seq: number; message: AgentDelivery; config?: AgentRuntimeConfig; channelId?: string; inboxSummary?: string }
  | { type: 'agent:reset-workspace'; agentId: string }
  | { type: 'workspace:read'; agentId: string; requestId: string; relPath: string }
  | { type: 'machine:runtime_models:detect'; runtime: RuntimeId; requestId: string };

export type Message = {
  id: string;
  projectId?: string;
  channelId: string;
  agentId?: string;
  actorType: ActorType;
  actorId: string;
  senderName: string;
  content: string;
  threadRootId?: string;
  replyCount?: number;
  latestReplyAt?: string;
  mentions?: Mention[];
  createdAt: string;
};

export type Mention = {
  type: 'agent' | 'user';
  id: string;
  label: string;
};

export type MessageThread = {
  root: Message;
  replies: Message[];
  linkedDecisions?: Decision[];
  linkedDocuments?: Document[];
};

export type SearchMessageResult = Message & {
  channelName: string;
};

export type Channel = {
  id: string;
  projectId?: string;
  name: string;
  createdAt: string;
};

export type Machine = {
  id: string;
  hostname: string;
  os: string;
  daemonVersion: string;
  runtimes: RuntimeId[];
  runtimeVersions: Record<string, string>;
  status: 'online' | 'offline';
  connectedAt: string;
};

export type Agent = {
  id: string;
  projectId?: string;
  name: string;
  displayName?: string;
  description?: string;
  runtime: RuntimeId;
  model?: string;
  systemPrompt?: string;
  envVars?: Record<string, string>;
  role?: AgentRole;
  responsibilities?: string[];
  capabilities?: AgentCapability[];
  workingStyle?: AgentWorkingStyle;
  handoffPreference?: string;
  constraints?: string[];
  examples?: string[];
  permissions?: AgentPermissions;
  organization?: {
    department?: string;
    roles?: string[];
    capabilities?: string[];
    responsibilities?: string[];
    managerId?: string;
    backupAgentIds?: string[];
    availability?: 'available' | 'unavailable' | 'overloaded';
  };
  machineId?: string;
  runtimeInstanceId?: string;
  status: AgentStatus;
  autoStart?: boolean;
  createdAt: string;
};

export type AgentMatchQuery = {
  role?: AgentRole;
  capabilities?: AgentCapability[];
  excludeAgentId?: string;
  mustBeIdle?: boolean;
  maxResults?: number;
};

export type AgentMatchResult = {
  agent: Agent;
  score: number;
  matchReason: string[];
};

export type BrowserEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'thread:message:new'; root: Message; message: Message }
  | { type: 'channel:created'; channel: Channel }
  | { type: 'channel:deleted'; channelId: string }
  | { type: 'agent:update'; agent: Agent }
  | { type: 'agent:updated'; agent: Agent }
  | { type: 'agent:deleted'; agentId: string }
  | { type: 'agent:activity'; agentId: string; activity: AgentActivity }
  | { type: 'dm:new'; dm: DirectMessage }
  | { type: 'agent:delegation'; delegation: AgentDelegation }
  | { type: 'goal:update'; goal: GoalBrief }
  | { type: 'goal-alignment:update'; alignment: GoalAlignment }
  | { type: 'knowledge:update'; entry: KnowledgeEntry }
  | { type: 'task:update'; task: Task }
  | { type: 'reminder:update'; reminder: Reminder }
  | { type: 'machine:update'; machine: Machine };
