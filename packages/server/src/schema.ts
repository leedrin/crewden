import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  channelId: text('channel_id').notNull(),
  senderName: text('sender_name').notNull(),
  content: text('content').notNull(),
  agentId: text('agent_id'),
  actorType: text('actor_type').notNull().default('human'),
  actorId: text('actor_id'),
  threadRootId: text('thread_root_id'),
  mentions: text('mentions'),
  createdAt: text('created_at').notNull(),
});

export const activities = sqliteTable('activities', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  type: text('type').notNull(),
  detail: text('detail'),
  createdAt: text('created_at').notNull(),
});

export const directMessages = sqliteTable('direct_messages', {
  id: text('id').primaryKey(),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export const agentDelegations = sqliteTable('agent_delegations', {
  id: text('id').primaryKey(),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  content: text('content').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

export const agentTokens = sqliteTable('agent_tokens', {
  agentId: text('agent_id').primaryKey(),
  token: text('token').notNull(),
  createdAt: text('created_at').notNull(),
});

export const auditLogs = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  taskId: text('task_id'),
  agentId: text('agent_id'),
  detailJson: text('detail_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id'),
  title: text('title').notNull(),
  status: text('status').notNull(),
  type: text('type').notNull().default('feature'),
  creatorName: text('creator_name').notNull(),
  creatorType: text('creator_type').notNull().default('human'),
  creatorId: text('creator_id'),
  assigneeId: text('assignee_id'),
  ownerType: text('owner_type'),
  ownerId: text('owner_id'),
  reviewerType: text('reviewer_type'),
  reviewerId: text('reviewer_id'),
  acceptanceCriteria: text('acceptance_criteria'),
  definitionOfDone: text('definition_of_done'),
  constraints: text('constraints'),
  dependsOn: text('depends_on'),
  isBlocked: integer('is_blocked', { mode: 'boolean' }).notNull().default(false),
  blockedReason: text('blocked_reason'),
  sourceChannelId: text('source_channel_id'),
  sourceThreadId: text('source_thread_id'),
  context: text('context'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  channelId: text('channel_id').notNull(),
  sourceMessageId: text('source_message_id'),
  requesterName: text('requester_name').notNull(),
  objective: text('objective').notNull(),
  background: text('background').notNull(),
  successCriteria: text('success_criteria').notNull(),
  constraints: text('constraints').notNull(),
  assumptions: text('assumptions').notNull(),
  risks: text('risks').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const goalAlignments = sqliteTable('goal_alignments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  channelId: text('channel_id').notNull(),
  threadRootId: text('thread_root_id').notNull(),
  sourceMessageId: text('source_message_id').notNull(),
  goalId: text('goal_id'),
  status: text('status').notNull(),
  objective: text('objective').notNull(),
  questions: text('questions').notNull(),
  answers: text('answers').notNull(),
  successCriteria: text('success_criteria').notNull(),
  constraints: text('constraints').notNull(),
  planSummary: text('plan_summary'),
  taskDrafts: text('task_drafts').notNull(),
  recommendedAgentIds: text('recommended_agent_ids').notNull(),
  reviewerAgentIds: text('reviewer_agent_ids').notNull(),
  recommendationReasons: text('recommendation_reasons').notNull(),
  gaps: text('gaps').notNull(),
  riskLevel: text('risk_level').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const reminders = sqliteTable('reminders', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  agentId: text('agent_id').notNull(),
  channelId: text('channel_id').notNull(),
  message: text('message').notNull(),
  triggerAt: text('trigger_at').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
});

export const knowledgeEntries = sqliteTable('knowledge_entries', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  body: text('body').notNull(),
  tags: text('tags').notNull(),
  sourceRefs: text('source_refs').notNull(),
  ownerAgentId: text('owner_agent_id'),
  reviewerAgentId: text('reviewer_agent_id'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const decisions = sqliteTable('decisions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  channelId: text('channel_id').notNull(),
  sourceThreadId: text('source_thread_id'),
  title: text('title').notNull(),
  status: text('status').notNull().default('proposed'),
  problem: text('problem').notNull(),
  alternatives: text('alternatives'),
  decisionText: text('decision_text').notNull(),
  rationale: text('rationale'),
  consequences: text('consequences'),
  participants: text('participants'),
  relatedDecisions: text('related_decisions'),
  supersededBy: text('superseded_by'),
  acceptedAt: text('accepted_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'),
  content: text('content').notNull().default(''),
  sourceThreadId: text('source_thread_id'),
  sourceChannelId: text('source_channel_id').notNull(),
  authorType: text('author_type').notNull(),
  authorId: text('author_id').notNull(),
  authorName: text('author_name').notNull(),
  reviewers: text('reviewers'),
  relatedDecisions: text('related_decisions'),
  relatedTasks: text('related_tasks'),
  supersededBy: text('superseded_by'),
  approvedAt: text('approved_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  name: text('name').notNull(),
  displayName: text('display_name'),
  description: text('description'),
  runtime: text('runtime').notNull(),
  model: text('model'),
  systemPrompt: text('system_prompt'),
  envVars: text('env_vars'),
  role: text('role'),
  responsibilities: text('responsibilities'),
  capabilities: text('capabilities'),
  workingStyle: text('working_style'),
  handoffPreference: text('handoff_preference'),
  constraintsText: text('constraints_text'),
  examples: text('examples'),
  organization: text('organization'),
  machineId: text('machine_id'),
  runtimeInstanceId: text('runtime_instance_id'),
  status: text('status').notNull(),
  autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const agentPermissions = sqliteTable('agent_permissions', {
  agentId: text('agent_id').primaryKey(),
  readChannels: text('read_channels'),
  writeChannels: text('write_channels'),
  createDocs: integer('create_docs', { mode: 'boolean' }).notNull().default(false),
  createTasks: integer('create_tasks', { mode: 'boolean' }).notNull().default(true),
  claimTasks: integer('claim_tasks', { mode: 'boolean' }).notNull().default(true),
  createBranches: integer('create_branches', { mode: 'boolean' }).notNull().default(false),
  createPrs: integer('create_prs', { mode: 'boolean' }).notNull().default(false),
  mergeToMain: integer('merge_to_main', { mode: 'boolean' }).notNull().default(false),
  deployToProd: integer('deploy_to_prod', { mode: 'boolean' }).notNull().default(false),
  accessSensitiveData: integer('access_sensitive_data', { mode: 'boolean' }).notNull().default(false),
  callExternalApis: text('call_external_apis'),
  maxContextTokens: integer('max_context_tokens').notNull().default(100000),
  requiresApprovalFor: text('requires_approval_for'),
});

export const machines = sqliteTable('machines', {
  id: text('id').primaryKey(),
  hostname: text('hostname').notNull(),
  os: text('os').notNull(),
  daemonVersion: text('daemon_version').notNull(),
  runtimes: text('runtimes').notNull(),
  runtimeVersions: text('runtime_versions').notNull(),
  status: text('status').notNull(),
  connectedAt: text('connected_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description').notNull().default(''),
  paseoProjectId: text('paseo_project_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
