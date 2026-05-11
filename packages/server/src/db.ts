import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { nanoid } from 'nanoid';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import { asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { ActorType, Channel, Message, MessageThread, Machine, Agent, RuntimeId, AgentStatus, AgentActivity, DirectMessage, DirectMessageThread, AgentDelegation, AgentTokenInfo, Task, TaskStatus, GoalBrief, GoalBriefStatus, GoalAlignment, GoalAlignmentStatus, Reminder, ReminderStatus, SearchMessageResult, KnowledgeEntry, KnowledgeKind, KnowledgeSearchResult, KnowledgeStatus, AgentPermissions, AgentCapability, AgentRole, Decision, DecisionStatus, Document, DocumentStatus, DocumentKind, Project, ThreadStatus } from '@crewden/shared';
import { resolveAgentReference, resolveAgents } from '@crewden/hub-core';
import { activities, agentDelegations, agentPermissions, agentTokens, agents, auditLogs, channels, decisions, directMessages, documents, goalAlignments, goals, knowledgeEntries, machines, messages, projects, reminders, tasks, threadSummaries } from './schema.js';
import { SqliteChannelRepository, SqliteProjectRepository, SqliteTaskRepository, SqliteMessageRepository, SqliteThreadRepository, SqliteContextPackageRefRepository, type NewTask, type NewMessage, type TaskPatch, type ThreadSummaryRow } from './repository/index.js';

type Database = LibSQLDatabase<typeof import('./schema.js')>;
const DEFAULT_PROJECT_ID = 'default';

export type AuditLog = {
  id: string;
  projectId: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  taskId?: string;
  agentId?: string;
  detailJson: Record<string, unknown>;
  createdAt: string;
};

let client: Client | null = null;
let db: Database | null = null;
let store: SqliteStore | null = null;
let initialized = false;
let initialization: Promise<void> | null = null;

function getDbPath(): string {
  return process.env.CREWDEN_DB_PATH || join(homedir(), '.crewden', 'data.db');
}

function getDbUrl(path: string): string {
  if (path === ':memory:') return 'file::memory:';
  return `file:${path}`;
}

async function ensureDbDirectory(path: string): Promise<void> {
  if (path === ':memory:') return;
  await mkdir(dirname(path), { recursive: true });
}

function createDatabase(): Database {
  const path = getDbPath();
  client = createClient({ url: getDbUrl(path) });
  db = drizzle(client, { schema: { activities, agentDelegations, agentPermissions, agentTokens, agents, auditLogs, channels, decisions, directMessages, documents, goalAlignments, goals, knowledgeEntries, machines, messages, projects, reminders, tasks, threadSummaries } });
  return db;
}

export function getDb(): Database {
  return db ?? createDatabase();
}

export async function initDb(): Promise<void> {
  if (initialized) return;
  if (initialization) return initialization;

  initialization = (async () => {
    const path = getDbPath();
    await ensureDbDirectory(path);
    const database = getDb();

    await database.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        paseo_project_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        channel_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT,
        actor_type TEXT NOT NULL DEFAULT 'human',
        actor_id TEXT,
        thread_root_id TEXT,
        intent TEXT NOT NULL DEFAULT 'chat',
        mentions TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`ALTER TABLE messages ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'human'`).catch(() => undefined);
    await database.run(`ALTER TABLE messages ADD COLUMN actor_id TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE messages ADD COLUMN thread_root_id TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE messages ADD COLUMN intent TEXT NOT NULL DEFAULT 'chat'`).catch(() => undefined);
    await database.run(`ALTER TABLE messages ADD COLUMN mentions TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE messages ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`
      CREATE TABLE IF NOT EXISTS thread_summaries (
        thread_root_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        summary_content TEXT,
        summary_generated_at TEXT,
        linked_decisions TEXT,
        linked_documents TEXT,
        linked_tasks TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        participants TEXT,
        created_at TEXT,
        resolved_at TEXT
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS agent_delegations (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS agent_tokens (
        agent_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        task_id TEXT,
        agent_id TEXT,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        channel_id TEXT NOT NULL,
        message_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'feature',
        creator_name TEXT NOT NULL,
        creator_type TEXT NOT NULL DEFAULT 'human',
        creator_id TEXT,
        assignee_id TEXT,
        owner_type TEXT,
        owner_id TEXT,
        reviewer_type TEXT,
        reviewer_id TEXT,
        acceptance_criteria TEXT,
        definition_of_done TEXT,
        constraints TEXT,
        depends_on TEXT,
        is_blocked INTEGER NOT NULL DEFAULT 0,
        blocked_reason TEXT,
        source_channel_id TEXT,
        source_thread_id TEXT,
        context TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        channel_id TEXT NOT NULL,
        source_message_id TEXT,
        requester_name TEXT NOT NULL,
        objective TEXT NOT NULL,
        background TEXT NOT NULL,
        success_criteria TEXT NOT NULL,
        constraints TEXT NOT NULL,
        assumptions TEXT NOT NULL,
        risks TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS goal_alignments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        channel_id TEXT NOT NULL,
        thread_root_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        goal_id TEXT,
        status TEXT NOT NULL,
        objective TEXT NOT NULL,
        questions TEXT NOT NULL,
        answers TEXT NOT NULL,
        success_criteria TEXT NOT NULL,
        constraints TEXT NOT NULL,
        plan_summary TEXT,
        task_drafts TEXT NOT NULL,
        recommended_agent_ids TEXT NOT NULL,
        reviewer_agent_ids TEXT NOT NULL,
        recommendation_reasons TEXT NOT NULL,
        gaps TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        agent_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message TEXT NOT NULL,
        trigger_at TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL,
        source_refs TEXT NOT NULL,
        owner_agent_id TEXT,
        reviewer_agent_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        channel_id TEXT NOT NULL,
        source_thread_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        problem TEXT NOT NULL,
        alternatives TEXT,
        decision_text TEXT NOT NULL,
        rationale TEXT,
        consequences TEXT,
        participants TEXT,
        related_decisions TEXT,
        superseded_by TEXT,
        accepted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_decisions_channel ON decisions(channel_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)`);
    await database.run(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        content TEXT NOT NULL DEFAULT '',
        source_thread_id TEXT,
        source_channel_id TEXT NOT NULL,
        author_type TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        reviewers TEXT,
        related_decisions TEXT,
        related_tasks TEXT,
        superseded_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_documents_channel ON documents(source_channel_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(kind)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)`);
    await database.run(`ALTER TABLE tasks ADD COLUMN context TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'feature'`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN creator_type TEXT NOT NULL DEFAULT 'human'`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN creator_id TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN owner_type TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN owner_id TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN reviewer_type TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN reviewer_id TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN definition_of_done TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN constraints TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN depends_on TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN blocked_reason TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN source_channel_id TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN source_thread_id TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`UPDATE tasks SET status = 'backlog' WHERE status = 'todo'`).catch(() => undefined);
    await database.run(`UPDATE tasks SET is_blocked = 1, status = 'in_progress' WHERE status = 'blocked'`).catch(() => undefined);
    await database.run(`UPDATE messages SET actor_type = 'agent', actor_id = agent_id WHERE agent_id IS NOT NULL AND actor_id IS NULL`).catch(() => undefined);
    await database.run(`UPDATE messages SET actor_type = 'human', actor_id = sender_name WHERE actor_id IS NULL`).catch(() => undefined);
    await database.run(`UPDATE messages SET intent = 'chat' WHERE intent IS NULL OR intent = ''`).catch(() => undefined);
    await database.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        runtime TEXT NOT NULL,
        model TEXT,
        system_prompt TEXT,
        env_vars TEXT,
        role TEXT,
        responsibilities TEXT,
        capabilities TEXT,
        working_style TEXT,
        handoff_preference TEXT,
        constraints_text TEXT,
        examples TEXT,
        organization TEXT,
        machine_id TEXT,
        runtime_instance_id TEXT,
        status TEXT NOT NULL,
        auto_start INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    try {
      await database.run('ALTER TABLE agents ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0');
    } catch (err) {
      const message = [String(err), (err as { message?: string }).message, (err as { cause?: { message?: string } }).cause?.message]
        .join(' ')
        .toLowerCase();
      if (!message.includes('duplicate column')) throw err;
    }
    await database.run(`ALTER TABLE agents ADD COLUMN env_vars TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN role TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN responsibilities TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN capabilities TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN working_style TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN handoff_preference TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN constraints_text TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN examples TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN organization TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN runtime_instance_id TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`UPDATE agents SET role = 'unassigned' WHERE role IS NULL`).catch(() => undefined);
    await database.run(`ALTER TABLE channels ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`ALTER TABLE goals ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`ALTER TABLE goal_alignments ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`ALTER TABLE reminders ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`ALTER TABLE knowledge_entries ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`ALTER TABLE decisions ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`ALTER TABLE documents ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`ALTER TABLE audit_log ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`).catch(() => undefined);
    await database.run(`
      CREATE TABLE IF NOT EXISTS agent_permissions (
        agent_id TEXT PRIMARY KEY,
        read_channels TEXT,
        write_channels TEXT,
        create_docs INTEGER NOT NULL DEFAULT 0,
        create_tasks INTEGER NOT NULL DEFAULT 1,
        claim_tasks INTEGER NOT NULL DEFAULT 1,
        create_branches INTEGER NOT NULL DEFAULT 0,
        create_prs INTEGER NOT NULL DEFAULT 0,
        merge_to_main INTEGER NOT NULL DEFAULT 0,
        deploy_to_prod INTEGER NOT NULL DEFAULT 0,
        access_sensitive_data INTEGER NOT NULL DEFAULT 0,
        call_external_apis TEXT,
        max_context_tokens INTEGER NOT NULL DEFAULT 100000,
        requires_approval_for TEXT
      )
    `);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_agents_runtime_instance_id ON agents(runtime_instance_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_channels_project ON channels(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_thread_summaries_project ON thread_summaries(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_goal_alignments_project ON goal_alignments(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_reminders_project ON reminders(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_entries(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id)`);
    await database.run(`
      CREATE TABLE IF NOT EXISTS context_package_refs (
        task_id TEXT NOT NULL,
        ref_type TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        ref_updated_at TEXT NOT NULL,
        PRIMARY KEY (task_id, ref_type, ref_id)
      )
    `);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_cp_refs_ref ON context_package_refs(ref_type, ref_id)`);
    await database.run(`
      CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL,
        os TEXT NOT NULL,
        daemon_version TEXT NOT NULL,
        runtimes TEXT NOT NULL,
        runtime_versions TEXT NOT NULL,
        status TEXT NOT NULL,
        connected_at TEXT NOT NULL
      )
    `);

    const now = new Date().toISOString();
    await database
      .insert(projects)
      .values({
        id: DEFAULT_PROJECT_ID,
        name: 'Default Project',
        slug: DEFAULT_PROJECT_ID,
        description: 'Auto-created during v2.2.1 migration',
        paseoProjectId: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await database
      .insert(channels)
      .values({ id: 'general', projectId: DEFAULT_PROJECT_ID, name: 'general', createdAt: new Date().toISOString() })
      .onConflictDoNothing();
    await resetVolatileState();

    initialized = true;
  })();

  try {
    await initialization;
  } finally {
    initialization = null;
  }
}

export async function resetVolatileState(): Promise<void> {
  const database = getDb();
  await database.update(machines).set({ status: 'offline' });
}

function defaultAgentPermissions(): AgentPermissions {
  return {
    readChannels: [],
    writeChannels: [],
    createDocs: false,
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
  };
}

function toAgentPermissions(row: typeof agentPermissions.$inferSelect): AgentPermissions {
  const defaults = defaultAgentPermissions();
  return {
    readChannels: parseStringArray(row.readChannels) ?? defaults.readChannels,
    writeChannels: parseStringArray(row.writeChannels) ?? defaults.writeChannels,
    createDocs: Boolean(row.createDocs),
    createTasks: row.createTasks === undefined ? defaults.createTasks : Boolean(row.createTasks),
    claimTasks: row.claimTasks === undefined ? defaults.claimTasks : Boolean(row.claimTasks),
    createBranches: Boolean(row.createBranches),
    createPrs: Boolean(row.createPrs),
    mergeToMain: Boolean(row.mergeToMain),
    deployToProd: Boolean(row.deployToProd),
    accessSensitiveData: Boolean(row.accessSensitiveData),
    callExternalApis: parseStringArray(row.callExternalApis) ?? defaults.callExternalApis,
    maxContextTokens: row.maxContextTokens ?? defaults.maxContextTokens,
    requiresApprovalFor: parseStringArray(row.requiresApprovalFor) ?? defaults.requiresApprovalFor,
  };
}

function normalizeRole(value: string | null | undefined): AgentRole {
  const allowed: AgentRole[] = ['unassigned', 'product', 'architect', 'developer', 'qa', 'reviewer', 'security', 'devops', 'documentation', 'coordinator', 'planner'];
  if (value && (allowed as string[]).includes(value)) return value as AgentRole;
  return 'unassigned';
}

function toAgent(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    name: row.name,
    displayName: row.displayName ?? undefined,
    description: row.description ?? undefined,
    runtime: row.runtime as RuntimeId,
    model: row.model ?? undefined,
    systemPrompt: row.systemPrompt ?? undefined,
    envVars: row.envVars ? JSON.parse(row.envVars) as Record<string, string> : undefined,
    role: normalizeRole(row.role),
    responsibilities: parseStringArray(row.responsibilities),
    capabilities: parseStringArray(row.capabilities) as AgentCapability[] | undefined,
    workingStyle: row.workingStyle as Agent['workingStyle'] | undefined,
    handoffPreference: row.handoffPreference ?? undefined,
    constraints: parseStringArray(row.constraintsText),
    examples: parseStringArray(row.examples),
    organization: row.organization ? JSON.parse(row.organization) as Agent['organization'] : undefined,
    machineId: row.machineId ?? undefined,
    runtimeInstanceId: row.runtimeInstanceId ?? undefined,
    status: row.status as AgentStatus,
    autoStart: row.autoStart,
    createdAt: row.createdAt,
  };
}

function toActivity(row: typeof activities.$inferSelect): AgentActivity {
  return {
    id: row.id,
    agentId: row.agentId,
    type: row.type as AgentActivity['type'],
    detail: row.detail ?? undefined,
    createdAt: row.createdAt,
  };
}

function toDirectMessage(row: typeof directMessages.$inferSelect): DirectMessage {
  return {
    id: row.id,
    fromAgentId: row.fromAgentId,
    toAgentId: row.toAgentId,
    content: row.content,
    createdAt: row.createdAt,
  };
}

function toAgentDelegation(row: typeof agentDelegations.$inferSelect): AgentDelegation {
  return {
    id: row.id,
    fromAgentId: row.fromAgentId,
    toAgentId: row.toAgentId,
    content: row.content,
    status: row.status as AgentDelegation['status'],
    error: row.error ?? undefined,
    createdAt: row.createdAt,
  };
}

function toAuditLog(row: typeof auditLogs.$inferSelect): AuditLog {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    actorType: row.actorType as AuditLog['actorType'],
    actorId: row.actorId ?? 'unknown',
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    taskId: row.taskId ?? undefined,
    agentId: row.agentId ?? undefined,
    detailJson: JSON.parse(row.detailJson) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

function parseStringArray(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
}

function toGoal(row: typeof goals.$inferSelect): GoalBrief {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    channelId: row.channelId,
    sourceMessageId: row.sourceMessageId ?? undefined,
    requesterName: row.requesterName,
    objective: row.objective,
    background: JSON.parse(row.background) as string[],
    successCriteria: JSON.parse(row.successCriteria) as string[],
    constraints: JSON.parse(row.constraints) as string[],
    assumptions: JSON.parse(row.assumptions) as string[],
    risks: JSON.parse(row.risks) as string[],
    status: row.status as GoalBriefStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toGoalAlignment(row: typeof goalAlignments.$inferSelect): GoalAlignment {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    channelId: row.channelId,
    threadRootId: row.threadRootId,
    sourceMessageId: row.sourceMessageId,
    goalId: row.goalId ?? undefined,
    status: row.status as GoalAlignmentStatus,
    objective: row.objective,
    questions: JSON.parse(row.questions) as string[],
    answers: JSON.parse(row.answers) as string[],
    successCriteria: JSON.parse(row.successCriteria) as string[],
    constraints: JSON.parse(row.constraints) as string[],
    planSummary: row.planSummary ?? undefined,
    taskDrafts: JSON.parse(row.taskDrafts) as GoalAlignment['taskDrafts'],
    recommendedAgentIds: JSON.parse(row.recommendedAgentIds) as string[],
    reviewerAgentIds: JSON.parse(row.reviewerAgentIds) as string[],
    recommendationReasons: JSON.parse(row.recommendationReasons) as Record<string, string>,
    gaps: JSON.parse(row.gaps) as string[],
    riskLevel: row.riskLevel as GoalAlignment['riskLevel'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toReminder(row: typeof reminders.$inferSelect): Reminder {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    agentId: row.agentId,
    channelId: row.channelId,
    message: row.message,
    triggerAt: row.triggerAt,
    status: row.status as ReminderStatus,
    createdAt: row.createdAt,
  };
}

function toKnowledgeEntry(row: typeof knowledgeEntries.$inferSelect): KnowledgeEntry {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    kind: row.kind as KnowledgeKind,
    title: row.title,
    summary: row.summary,
    body: row.body,
    tags: JSON.parse(row.tags) as string[],
    sourceRefs: JSON.parse(row.sourceRefs) as string[],
    ownerAgentId: row.ownerAgentId ?? undefined,
    reviewerAgentId: row.reviewerAgentId ?? undefined,
    status: row.status as KnowledgeStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeDecisionStatus(status: string): DecisionStatus {
  if (status === 'accepted' || status === 'deprecated' || status === 'superseded') return status;
  return 'proposed';
}

function toDecision(row: typeof decisions.$inferSelect): Decision {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    channelId: row.channelId,
    sourceThreadId: row.sourceThreadId ?? undefined,
    title: row.title,
    status: normalizeDecisionStatus(row.status),
    problem: row.problem,
    alternatives: parseStringArray(row.alternatives),
    decisionText: row.decisionText,
    rationale: row.rationale ?? undefined,
    consequences: parseStringArray(row.consequences),
    participants: row.participants ? JSON.parse(row.participants) as Decision['participants'] : undefined,
    relatedDecisions: parseStringArray(row.relatedDecisions),
    supersededBy: row.supersededBy ?? undefined,
    acceptedAt: row.acceptedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeDocumentStatus(status: string): DocumentStatus {
  if (status === 'in_review' || status === 'approved' || status === 'deprecated' || status === 'superseded') return status;
  return 'draft';
}

function toDocument(row: typeof documents.$inferSelect): Document {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    kind: row.kind as DocumentKind,
    title: row.title,
    status: normalizeDocumentStatus(row.status),
    content: row.content,
    sourceThreadId: row.sourceThreadId ?? undefined,
    sourceChannelId: row.sourceChannelId,
    author: {
      actorType: row.authorType as ActorType,
      actorId: row.authorId,
    },
    authorName: row.authorName,
    reviewers: row.reviewers ? JSON.parse(row.reviewers) as Document['reviewers'] : undefined,
    relatedDecisions: parseStringArray(row.relatedDecisions),
    relatedTasks: parseStringArray(row.relatedTasks),
    supersededBy: row.supersededBy ?? undefined,
    approvedAt: row.approvedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function scoreKnowledge(entry: KnowledgeEntry, query: string): number {
  if (!query) return 1;
  let score = 0;
  if (entry.title.toLowerCase().includes(query)) score += 8;
  if (entry.summary.toLowerCase().includes(query)) score += 5;
  if (entry.body.toLowerCase().includes(query)) score += 2;
  score += entry.tags.filter((tag) => tag.toLowerCase().includes(query)).length * 4;
  return score;
}

function toMachine(row: typeof machines.$inferSelect): Machine {
  return {
    id: row.id,
    hostname: row.hostname,
    os: row.os,
    daemonVersion: row.daemonVersion,
    runtimes: JSON.parse(row.runtimes) as RuntimeId[],
    runtimeVersions: JSON.parse(row.runtimeVersions) as Record<string, string>,
    status: row.status as Machine['status'],
    connectedAt: row.connectedAt,
  };
}

export class SqliteStore {
  private _channelRepo: SqliteChannelRepository | null = null;
  private _projectRepo: SqliteProjectRepository | null = null;
  private _taskRepo: SqliteTaskRepository | null = null;
  private _messageRepo: SqliteMessageRepository | null = null;
  private _threadRepo: SqliteThreadRepository | null = null;
  private _cpRefRepo: SqliteContextPackageRefRepository | null = null;

  private get channelRepo(): SqliteChannelRepository {
    if (!this._channelRepo) this._channelRepo = new SqliteChannelRepository(getDb());
    return this._channelRepo;
  }

  private get projectRepo(): SqliteProjectRepository {
    if (!this._projectRepo) this._projectRepo = new SqliteProjectRepository(getDb());
    return this._projectRepo;
  }

  private get taskRepo(): SqliteTaskRepository {
    if (!this._taskRepo) this._taskRepo = new SqliteTaskRepository(getDb(), client);
    return this._taskRepo;
  }

  private get messageRepo(): SqliteMessageRepository {
    if (!this._messageRepo) this._messageRepo = new SqliteMessageRepository(getDb());
    return this._messageRepo;
  }

  private get threadRepo(): SqliteThreadRepository {
    if (!this._threadRepo) this._threadRepo = new SqliteThreadRepository(getDb());
    return this._threadRepo;
  }

  private get cpRefRepo(): SqliteContextPackageRefRepository {
    if (!this._cpRefRepo && client) this._cpRefRepo = new SqliteContextPackageRefRepository(client);
    return this._cpRefRepo!;
  }

  private async listAgentPermissionsByIds(agentIds: string[]): Promise<Map<string, AgentPermissions>> {
    if (agentIds.length === 0) return new Map();
    const rows = await getDb()
      .select()
      .from(agentPermissions)
      .where(inArray(agentPermissions.agentId, agentIds));
    return new Map(rows.map((row) => [row.agentId, toAgentPermissions(row)]));
  }

  private async withAgentPermissions(agentList: Agent[]): Promise<Agent[]> {
    const permissionMap = await this.listAgentPermissionsByIds(agentList.map((agent) => agent.id));
    return agentList.map((agent) => ({
      ...agent,
      permissions: permissionMap.get(agent.id) ?? defaultAgentPermissions(),
    }));
  }

  async getAgentPermissions(agentId: string): Promise<AgentPermissions> {
    await initDb();
    const [row] = await getDb().select().from(agentPermissions).where(eq(agentPermissions.agentId, agentId)).limit(1);
    return row ? toAgentPermissions(row) : defaultAgentPermissions();
  }

  async setAgentPermissions(agentId: string, permissions: AgentPermissions): Promise<AgentPermissions> {
    await initDb();
    await getDb().insert(agentPermissions).values({
      agentId,
      readChannels: JSON.stringify(permissions.readChannels),
      writeChannels: JSON.stringify(permissions.writeChannels),
      createDocs: permissions.createDocs,
      createTasks: permissions.createTasks,
      claimTasks: permissions.claimTasks,
      createBranches: permissions.createBranches,
      createPrs: permissions.createPrs,
      mergeToMain: permissions.mergeToMain,
      deployToProd: permissions.deployToProd,
      accessSensitiveData: permissions.accessSensitiveData,
      callExternalApis: JSON.stringify(permissions.callExternalApis),
      maxContextTokens: permissions.maxContextTokens,
      requiresApprovalFor: JSON.stringify(permissions.requiresApprovalFor),
    }).onConflictDoUpdate({
      target: agentPermissions.agentId,
      set: {
        readChannels: JSON.stringify(permissions.readChannels),
        writeChannels: JSON.stringify(permissions.writeChannels),
        createDocs: permissions.createDocs,
        createTasks: permissions.createTasks,
        claimTasks: permissions.claimTasks,
        createBranches: permissions.createBranches,
        createPrs: permissions.createPrs,
        mergeToMain: permissions.mergeToMain,
        deployToProd: permissions.deployToProd,
        accessSensitiveData: permissions.accessSensitiveData,
        callExternalApis: JSON.stringify(permissions.callExternalApis),
        maxContextTokens: permissions.maxContextTokens,
        requiresApprovalFor: JSON.stringify(permissions.requiresApprovalFor),
      },
    });
    return permissions;
  }

  async listChannels(filter: { projectId?: string } = {}): Promise<Channel[]> {
    await initDb();
    return this.channelRepo.list(filter);
  }

  async getChannel(id: string, filter: { projectId?: string } = {}): Promise<Channel | undefined> {
    await initDb();
    return this.channelRepo.getById(id, filter);
  }

  async createChannel(id: string, name: string, projectId = DEFAULT_PROJECT_ID): Promise<Channel> {
    await initDb();
    return this.channelRepo.create(id, name, projectId);
  }

  async deleteChannel(id: string): Promise<boolean> {
    await initDb();
    return this.channelRepo.delete(id);
  }

  async listProjects(): Promise<Project[]> {
    await initDb();
    return this.projectRepo.list();
  }

  async getProject(id: string): Promise<Project | undefined> {
    await initDb();
    return this.projectRepo.getById(id);
  }

  async getProjectBySlug(slug: string): Promise<Project | undefined> {
    await initDb();
    return this.projectRepo.getBySlug(slug);
  }

  async createProject(input: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project> {
    await initDb();
    return this.projectRepo.create(input);
  }

  async updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Project | undefined> {
    await initDb();
    return this.projectRepo.update(id, patch);
  }

  async deleteProject(id: string): Promise<boolean> {
    await initDb();
    return this.projectRepo.delete(id);
  }

  async listMessages(channelId: string): Promise<Message[]> {
    await initDb();
    return this.messageRepo.listByChannel(channelId);
  }

  async listRecentMessages(channelId: string, limit: number): Promise<Message[]> {
    await initDb();
    return this.messageRepo.listRecent(channelId, limit);
  }

  async searchMessages(query: string, limit: number, projectId?: string): Promise<SearchMessageResult[]> {
    await initDb();
    return this.messageRepo.search(query, limit, projectId);
  }

  async createMessage(msg: NewMessage): Promise<Message> {
    await initDb();
    const message = await this.messageRepo.create(msg);
    await this.threadRepo.refreshSummary(message.threadRootId ?? message.id);
    return message;
  }

  async getThreadSummary(rootId: string): Promise<ThreadSummaryRow | undefined> {
    await initDb();
    return this.threadRepo.getSummary(rootId);
  }

  async setThreadStatus(rootId: string, status: ThreadStatus): Promise<ThreadSummaryRow | undefined> {
    await initDb();
    return this.threadRepo.setThreadStatus(rootId, status);
  }

  async appendMessageContent(id: string, appendText: string): Promise<Message | undefined> {
    await initDb();
    return this.messageRepo.appendContent(id, appendText);
  }

  async addMessage(msg: NewMessage): Promise<Message> {
    return this.createMessage(msg);
  }

  async createAgentActivity(activity: Omit<AgentActivity, 'createdAt'>): Promise<AgentActivity> {
    await initDb();
    const created: AgentActivity = { ...activity, createdAt: new Date().toISOString() };
    await getDb().insert(activities).values({
      ...created,
      detail: created.detail ?? null,
    });
    await this.truncateAgentActivities(created.agentId, 500);
    return created;
  }

  async listAgentActivities(agentId: string, limit = 200): Promise<AgentActivity[]> {
    await initDb();
    const rows = await getDb()
      .select()
      .from(activities)
      .where(eq(activities.agentId, agentId))
      .orderBy(desc(activities.createdAt))
      .limit(limit);
    return rows.map(toActivity);
  }

  private async truncateAgentActivities(agentId: string, keep: number): Promise<void> {
    const stale = await getDb()
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.agentId, agentId))
      .orderBy(desc(activities.createdAt))
      .limit(100000)
      .offset(keep);
    if (stale.length > 0) {
      await getDb().delete(activities).where(inArray(activities.id, stale.map((row) => row.id)));
    }
  }

  async getMessage(id: string): Promise<Message | undefined> {
    await initDb();
    return this.messageRepo.getById(id);
  }

  async getThread(rootId: string): Promise<MessageThread | undefined> {
    await initDb();
    return this.threadRepo.getThread(rootId);
  }

  async createDirectMessage(dm: Omit<DirectMessage, 'createdAt'>): Promise<DirectMessage> {
    await initDb();
    const created: DirectMessage = { ...dm, createdAt: new Date().toISOString() };
    await getDb().insert(directMessages).values(created);
    return created;
  }

  async createAgentDelegation(delegation: Omit<AgentDelegation, 'createdAt'>): Promise<AgentDelegation> {
    await initDb();
    const created: AgentDelegation = { ...delegation, createdAt: new Date().toISOString() };
    await getDb().insert(agentDelegations).values({
      ...created,
      error: created.error ?? null,
    });
    return created;
  }

  async updateAgentDelegation(id: string, patch: Partial<Pick<AgentDelegation, 'status' | 'error'>>): Promise<AgentDelegation | undefined> {
    await initDb();
    const [existing] = await getDb().select().from(agentDelegations).where(eq(agentDelegations.id, id)).limit(1);
    if (!existing) return undefined;
    await getDb()
      .update(agentDelegations)
      .set({
        status: patch.status ?? existing.status,
        error: patch.error ?? existing.error,
      })
      .where(eq(agentDelegations.id, id));
    const [updated] = await getDb().select().from(agentDelegations).where(eq(agentDelegations.id, id)).limit(1);
    return updated ? toAgentDelegation(updated) : undefined;
  }

  async listAgentDelegations(agentId: string): Promise<AgentDelegation[]> {
    await initDb();
    const rows = await getDb()
      .select()
      .from(agentDelegations)
      .where(or(eq(agentDelegations.fromAgentId, agentId), eq(agentDelegations.toAgentId, agentId)))
      .orderBy(desc(agentDelegations.createdAt));
    return rows.map(toAgentDelegation);
  }

  async appendAuditLog(entry: Omit<AuditLog, 'id' | 'createdAt' | 'actorId' | 'projectId'> & { id?: string; actorId?: string; projectId?: string }): Promise<AuditLog> {
    await initDb();
    const created: AuditLog = {
      ...entry,
      projectId: entry.projectId ?? DEFAULT_PROJECT_ID,
      actorId: entry.actorId ?? entry.actorType,
      id: entry.id ?? nanoid(),
      createdAt: new Date().toISOString(),
    };
    await getDb().insert(auditLogs).values({
      id: created.id,
      projectId: created.projectId,
      actorType: created.actorType,
      actorId: created.actorId,
      action: created.action,
      entityType: created.entityType,
      entityId: created.entityId,
      taskId: created.taskId ?? null,
      agentId: created.agentId ?? null,
      detailJson: JSON.stringify(created.detailJson),
      createdAt: created.createdAt,
    });
    return created;
  }

  async listAuditLogs(filter: { projectId?: string; taskId?: string; entityType?: string; entityId?: string } = {}): Promise<AuditLog[]> {
    await initDb();
    const rows = await getDb().select().from(auditLogs).orderBy(asc(auditLogs.createdAt));
    return rows
      .map(toAuditLog)
      .filter((entry) =>
        (!filter.projectId || entry.projectId === filter.projectId) &&
        (!filter.taskId || entry.taskId === filter.taskId) &&
        (!filter.entityType || entry.entityType === filter.entityType) &&
        (!filter.entityId || entry.entityId === filter.entityId)
      );
  }

  async listTasks(filter: { projectId?: string; channelId?: string; status?: TaskStatus; assigneeId?: string } = {}): Promise<Task[]> {
    await initDb();
    return this.taskRepo.list(filter);
  }

  async getTask(id: string): Promise<Task | undefined> {
    await initDb();
    return this.taskRepo.getById(id);
  }

  async createTask(task: NewTask): Promise<Task> {
    await initDb();
    return this.taskRepo.create(task);
  }

  async updateTask(id: string, patch: TaskPatch): Promise<Task | undefined> {
    await initDb();
    return this.taskRepo.update(id, patch);
  }

  async deleteTask(id: string): Promise<boolean> {
    await initDb();
    return this.taskRepo.delete(id);
  }

  async addContextPackageRef(taskId: string, refType: string, refId: string, refUpdatedAt: string): Promise<void> {
    await initDb();
    if (!this.cpRefRepo) return;
    await this.cpRefRepo.addRef(taskId, refType, refId, refUpdatedAt);
  }

  async removeContextPackageRefsForTask(taskId: string): Promise<void> {
    await initDb();
    if (!this.cpRefRepo) return;
    await this.cpRefRepo.removeRefsForTask(taskId);
  }

  async findTaskIdsByRef(refType: string, refId: string): Promise<string[]> {
    await initDb();
    if (!this.cpRefRepo) return [];
    return this.cpRefRepo.findTaskIdsByRef(refType, refId);
  }

  async markContextPackagesStale(refType: string, refId: string): Promise<number> {
    await initDb();
    const taskIds = await this.findTaskIdsByRef(refType, refId);
    for (const taskId of taskIds) {
      const task = await this.getTask(taskId);
      if (task?.context?.contextPackage && !task.context.contextPackage.stale) {
        task.context.contextPackage.stale = true;
        task.context.contextPackage.staleReason = `${refType} updated: ${refId}`;
        await this.updateTask(taskId, { context: task.context });
      }
    }
    return taskIds.length;
  }

  async listGoals(filter: { projectId?: string; channelId?: string; status?: GoalBriefStatus } = {}): Promise<GoalBrief[]> {
    await initDb();
    const rows = await getDb().select().from(goals).orderBy(asc(goals.createdAt));
    return rows
      .map(toGoal)
      .filter((goal) =>
        (!filter.projectId || goal.projectId === filter.projectId) &&
        (!filter.channelId || goal.channelId === filter.channelId) &&
        (!filter.status || goal.status === filter.status)
      );
  }

  async getGoal(id: string): Promise<GoalBrief | undefined> {
    await initDb();
    const [goal] = await getDb().select().from(goals).where(eq(goals.id, id)).limit(1);
    return goal ? toGoal(goal) : undefined;
  }

  async createGoal(goal: Omit<GoalBrief, 'createdAt' | 'updatedAt' | 'projectId'> & Partial<Pick<GoalBrief, 'projectId'>>): Promise<GoalBrief> {
    await initDb();
    const now = new Date().toISOString();
    const created: GoalBrief = { ...goal, projectId: goal.projectId ?? DEFAULT_PROJECT_ID, createdAt: now, updatedAt: now };
    await getDb().insert(goals).values({
      ...created,
      projectId: created.projectId,
      sourceMessageId: created.sourceMessageId ?? null,
      background: JSON.stringify(created.background),
      successCriteria: JSON.stringify(created.successCriteria),
      constraints: JSON.stringify(created.constraints),
      assumptions: JSON.stringify(created.assumptions),
      risks: JSON.stringify(created.risks),
    });
    return created;
  }

  async updateGoal(id: string, patch: Partial<Pick<GoalBrief, 'objective' | 'background' | 'successCriteria' | 'constraints' | 'assumptions' | 'risks' | 'status'>>): Promise<GoalBrief | undefined> {
    await initDb();
    const existing = await this.getGoal(id);
    if (!existing) return undefined;
    const updated: GoalBrief = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await getDb()
      .update(goals)
      .set({
        objective: updated.objective,
        background: JSON.stringify(updated.background),
        successCriteria: JSON.stringify(updated.successCriteria),
        constraints: JSON.stringify(updated.constraints),
        assumptions: JSON.stringify(updated.assumptions),
        risks: JSON.stringify(updated.risks),
        status: updated.status,
        updatedAt: updated.updatedAt,
      })
      .where(eq(goals.id, id));
    return updated;
  }

  async listGoalAlignments(filter: { projectId?: string; channelId?: string; status?: GoalAlignmentStatus } = {}): Promise<GoalAlignment[]> {
    await initDb();
    const rows = await getDb().select().from(goalAlignments).orderBy(asc(goalAlignments.createdAt));
    return rows
      .map(toGoalAlignment)
      .filter((alignment) =>
        (!filter.projectId || alignment.projectId === filter.projectId) &&
        (!filter.channelId || alignment.channelId === filter.channelId) &&
        (!filter.status || alignment.status === filter.status)
      );
  }

  async getGoalAlignment(id: string): Promise<GoalAlignment | undefined> {
    await initDb();
    const [alignment] = await getDb().select().from(goalAlignments).where(eq(goalAlignments.id, id)).limit(1);
    return alignment ? toGoalAlignment(alignment) : undefined;
  }

  async createGoalAlignment(alignment: Omit<GoalAlignment, 'createdAt' | 'updatedAt' | 'projectId'> & Partial<Pick<GoalAlignment, 'projectId'>>): Promise<GoalAlignment> {
    await initDb();
    const now = new Date().toISOString();
    const created: GoalAlignment = { ...alignment, projectId: alignment.projectId ?? DEFAULT_PROJECT_ID, createdAt: now, updatedAt: now };
    await getDb().insert(goalAlignments).values({
      ...created,
      projectId: created.projectId,
      goalId: created.goalId ?? null,
      questions: JSON.stringify(created.questions),
      answers: JSON.stringify(created.answers),
      successCriteria: JSON.stringify(created.successCriteria),
      constraints: JSON.stringify(created.constraints),
      planSummary: created.planSummary ?? null,
      taskDrafts: JSON.stringify(created.taskDrafts),
      recommendedAgentIds: JSON.stringify(created.recommendedAgentIds),
      reviewerAgentIds: JSON.stringify(created.reviewerAgentIds),
      recommendationReasons: JSON.stringify(created.recommendationReasons),
      gaps: JSON.stringify(created.gaps),
    });
    return created;
  }

  async updateGoalAlignment(id: string, patch: Partial<Omit<GoalAlignment, 'id' | 'channelId' | 'threadRootId' | 'sourceMessageId' | 'createdAt' | 'updatedAt'>>): Promise<GoalAlignment | undefined> {
    await initDb();
    const existing = await this.getGoalAlignment(id);
    if (!existing) return undefined;
    const updated: GoalAlignment = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await getDb()
      .update(goalAlignments)
      .set({
        goalId: updated.goalId ?? null,
        status: updated.status,
        objective: updated.objective,
        questions: JSON.stringify(updated.questions),
        answers: JSON.stringify(updated.answers),
        successCriteria: JSON.stringify(updated.successCriteria),
        constraints: JSON.stringify(updated.constraints),
        planSummary: updated.planSummary ?? null,
        taskDrafts: JSON.stringify(updated.taskDrafts),
        recommendedAgentIds: JSON.stringify(updated.recommendedAgentIds),
        reviewerAgentIds: JSON.stringify(updated.reviewerAgentIds),
        recommendationReasons: JSON.stringify(updated.recommendationReasons),
        gaps: JSON.stringify(updated.gaps),
        riskLevel: updated.riskLevel,
        updatedAt: updated.updatedAt,
      })
      .where(eq(goalAlignments.id, id));
    return updated;
  }

  async listReminders(filter: { projectId?: string; agentId?: string } | string = {}): Promise<Reminder[]> {
    await initDb();
    const normalized = typeof filter === 'string' ? { agentId: filter } : filter;
    const rows = await getDb().select().from(reminders).orderBy(asc(reminders.triggerAt));
    return rows
      .map(toReminder)
      .filter((reminder) => (!normalized.projectId || reminder.projectId === normalized.projectId) && (!normalized.agentId || reminder.agentId === normalized.agentId));
  }

  async listDueReminders(nowIso: string): Promise<Reminder[]> {
    return (await this.listReminders()).filter((reminder) => reminder.status === 'pending' && reminder.triggerAt <= nowIso);
  }

  async getReminder(id: string): Promise<Reminder | undefined> {
    await initDb();
    const [reminder] = await getDb().select().from(reminders).where(eq(reminders.id, id)).limit(1);
    return reminder ? toReminder(reminder) : undefined;
  }

  async createReminder(reminder: Omit<Reminder, 'createdAt' | 'projectId'> & Partial<Pick<Reminder, 'projectId'>>): Promise<Reminder> {
    await initDb();
    const created: Reminder = { ...reminder, projectId: reminder.projectId ?? DEFAULT_PROJECT_ID, createdAt: new Date().toISOString() };
    await getDb().insert(reminders).values(created);
    return created;
  }

  async updateReminder(id: string, patch: Partial<Pick<Reminder, 'status'>>): Promise<Reminder | undefined> {
    await initDb();
    const existing = await this.getReminder(id);
    if (!existing) return undefined;
    const updated: Reminder = { ...existing, status: patch.status ?? existing.status };
    await getDb().update(reminders).set({ status: updated.status }).where(eq(reminders.id, id));
    return updated;
  }

  async searchKnowledge(filter: { projectId?: string; query?: string; kind?: KnowledgeKind; tags?: string[]; limit?: number } = {}): Promise<KnowledgeSearchResult[]> {
    await initDb();
    const rows = await getDb().select().from(knowledgeEntries).orderBy(desc(knowledgeEntries.updatedAt));
    const query = (filter.query ?? '').trim().toLowerCase();
    const tags = filter.tags ?? [];
    return rows
      .map(toKnowledgeEntry)
      .map((entry) => ({ entry, score: scoreKnowledge(entry, query), reason: query ? `Matched "${query}"` : 'Recent knowledge' }))
      .filter((result) =>
        (!filter.projectId || result.entry.projectId === filter.projectId) &&
        (!filter.kind || result.entry.kind === filter.kind) &&
        tags.every((tag) => result.entry.tags.includes(tag))
      )
      .filter((result) => !query || result.score > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || new Date(b.entry.updatedAt).getTime() - new Date(a.entry.updatedAt).getTime())
      .slice(0, filter.limit ?? 20);
  }

  async getKnowledgeEntry(id: string): Promise<KnowledgeEntry | undefined> {
    await initDb();
    const [entry] = await getDb().select().from(knowledgeEntries).where(eq(knowledgeEntries.id, id)).limit(1);
    return entry ? toKnowledgeEntry(entry) : undefined;
  }

  async createKnowledgeEntry(entry: Omit<KnowledgeEntry, 'createdAt' | 'updatedAt' | 'projectId'> & Partial<Pick<KnowledgeEntry, 'projectId'>>): Promise<KnowledgeEntry> {
    await initDb();
    const now = new Date().toISOString();
    const created: KnowledgeEntry = { ...entry, projectId: entry.projectId ?? DEFAULT_PROJECT_ID, createdAt: now, updatedAt: now };
    await getDb().insert(knowledgeEntries).values({
      ...created,
      projectId: created.projectId,
      tags: JSON.stringify(created.tags),
      sourceRefs: JSON.stringify(created.sourceRefs),
      ownerAgentId: created.ownerAgentId ?? null,
      reviewerAgentId: created.reviewerAgentId ?? null,
    });
    return created;
  }

  async updateKnowledgeEntry(id: string, patch: Partial<Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>>): Promise<KnowledgeEntry | undefined> {
    await initDb();
    const existing = await this.getKnowledgeEntry(id);
    if (!existing) return undefined;
    const updated: KnowledgeEntry = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await getDb().update(knowledgeEntries).set({
      kind: updated.kind,
      title: updated.title,
      summary: updated.summary,
      body: updated.body,
      tags: JSON.stringify(updated.tags),
      sourceRefs: JSON.stringify(updated.sourceRefs),
      ownerAgentId: updated.ownerAgentId ?? null,
      reviewerAgentId: updated.reviewerAgentId ?? null,
      status: updated.status,
      updatedAt: updated.updatedAt,
    }).where(eq(knowledgeEntries.id, id));
    return updated;
  }

  async listDecisions(filter: { projectId?: string; channelId?: string; status?: DecisionStatus } = {}): Promise<Decision[]> {
    await initDb();
    const rows = await getDb().select().from(decisions).orderBy(desc(decisions.updatedAt));
    return rows
      .map(toDecision)
      .filter((decision) =>
        (!filter.projectId || decision.projectId === filter.projectId) &&
        (!filter.channelId || decision.channelId === filter.channelId) &&
        (!filter.status || decision.status === filter.status)
      );
  }

  async getDecision(id: string): Promise<Decision | undefined> {
    await initDb();
    const [row] = await getDb().select().from(decisions).where(eq(decisions.id, id)).limit(1);
    return row ? toDecision(row) : undefined;
  }

  async createDecision(input: Omit<Decision, 'createdAt' | 'updatedAt' | 'projectId'> & Partial<Pick<Decision, 'projectId'>>): Promise<Decision> {
    await initDb();
    const now = new Date().toISOString();
    const created: Decision = { ...input, projectId: input.projectId ?? DEFAULT_PROJECT_ID, createdAt: now, updatedAt: now };
    await getDb().insert(decisions).values({
      ...created,
      projectId: created.projectId,
      sourceThreadId: created.sourceThreadId ?? null,
      alternatives: created.alternatives ? JSON.stringify(created.alternatives) : null,
      rationale: created.rationale ?? null,
      consequences: created.consequences ? JSON.stringify(created.consequences) : null,
      participants: created.participants ? JSON.stringify(created.participants) : null,
      relatedDecisions: created.relatedDecisions ? JSON.stringify(created.relatedDecisions) : null,
      supersededBy: created.supersededBy ?? null,
      acceptedAt: created.acceptedAt ?? null,
    });
    return created;
  }

  async updateDecision(id: string, patch: Partial<Omit<Decision, 'id' | 'createdAt'>>): Promise<Decision | undefined> {
    await initDb();
    const existing = await this.getDecision(id);
    if (!existing) return undefined;
    const updated: Decision = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await getDb().update(decisions).set({
      channelId: updated.channelId,
      sourceThreadId: updated.sourceThreadId ?? null,
      title: updated.title,
      status: updated.status,
      problem: updated.problem,
      alternatives: updated.alternatives ? JSON.stringify(updated.alternatives) : null,
      decisionText: updated.decisionText,
      rationale: updated.rationale ?? null,
      consequences: updated.consequences ? JSON.stringify(updated.consequences) : null,
      participants: updated.participants ? JSON.stringify(updated.participants) : null,
      relatedDecisions: updated.relatedDecisions ? JSON.stringify(updated.relatedDecisions) : null,
      supersededBy: updated.supersededBy ?? null,
      acceptedAt: updated.acceptedAt ?? null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }).where(eq(decisions.id, id));
    return updated;
  }

  async listDocuments(filter: { projectId?: string; sourceChannelId?: string; kind?: DocumentKind; status?: DocumentStatus } = {}): Promise<Document[]> {
    await initDb();
    const rows = await getDb().select().from(documents).orderBy(desc(documents.updatedAt));
    return rows
      .map(toDocument)
      .filter((document) =>
        (!filter.projectId || document.projectId === filter.projectId) &&
        (!filter.sourceChannelId || document.sourceChannelId === filter.sourceChannelId) &&
        (!filter.kind || document.kind === filter.kind) &&
        (!filter.status || document.status === filter.status)
      );
  }

  async getDocument(id: string): Promise<Document | undefined> {
    await initDb();
    const [row] = await getDb().select().from(documents).where(eq(documents.id, id)).limit(1);
    return row ? toDocument(row) : undefined;
  }

  async createDocument(input: Omit<Document, 'createdAt' | 'updatedAt' | 'projectId'> & Partial<Pick<Document, 'projectId'>>): Promise<Document> {
    await initDb();
    const now = new Date().toISOString();
    const created: Document = { ...input, projectId: input.projectId ?? DEFAULT_PROJECT_ID, createdAt: now, updatedAt: now };
    await getDb().insert(documents).values({
      ...created,
      projectId: created.projectId,
      sourceThreadId: created.sourceThreadId ?? null,
      authorType: created.author.actorType,
      authorId: created.author.actorId,
      reviewers: created.reviewers ? JSON.stringify(created.reviewers) : null,
      relatedDecisions: created.relatedDecisions ? JSON.stringify(created.relatedDecisions) : null,
      relatedTasks: created.relatedTasks ? JSON.stringify(created.relatedTasks) : null,
      supersededBy: created.supersededBy ?? null,
      approvedAt: created.approvedAt ?? null,
    });
    return created;
  }

  async updateDocument(id: string, patch: Partial<Omit<Document, 'id' | 'createdAt'>>): Promise<Document | undefined> {
    await initDb();
    const existing = await this.getDocument(id);
    if (!existing) return undefined;
    const updated: Document = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await getDb().update(documents).set({
      kind: updated.kind,
      title: updated.title,
      status: updated.status,
      content: updated.content,
      sourceThreadId: updated.sourceThreadId ?? null,
      sourceChannelId: updated.sourceChannelId,
      authorType: updated.author.actorType,
      authorId: updated.author.actorId,
      authorName: updated.authorName,
      reviewers: updated.reviewers ? JSON.stringify(updated.reviewers) : null,
      relatedDecisions: updated.relatedDecisions ? JSON.stringify(updated.relatedDecisions) : null,
      relatedTasks: updated.relatedTasks ? JSON.stringify(updated.relatedTasks) : null,
      supersededBy: updated.supersededBy ?? null,
      approvedAt: updated.approvedAt ?? null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }).where(eq(documents.id, id));
    return updated;
  }

  async listDirectMessages(agentId: string, otherId: string): Promise<DirectMessage[]> {
    await initDb();
    const rows = await getDb()
      .select()
      .from(directMessages)
      .where(
        or(
          eq(directMessages.fromAgentId, agentId),
          eq(directMessages.toAgentId, agentId),
        ),
      )
      .orderBy(asc(directMessages.createdAt));
    return rows
      .map(toDirectMessage)
      .filter((dm) => [dm.fromAgentId, dm.toAgentId].includes(otherId));
  }

  async listDirectMessageThreads(agentId: string): Promise<DirectMessageThread[]> {
    await initDb();
    const rows = await getDb()
      .select()
      .from(directMessages)
      .where(
        or(
          eq(directMessages.fromAgentId, agentId),
          eq(directMessages.toAgentId, agentId),
        ),
      )
      .orderBy(desc(directMessages.createdAt));
    const seen = new Set<string>();
    const threads: DirectMessageThread[] = [];
    for (const row of rows.map(toDirectMessage)) {
      const otherAgentId = row.fromAgentId === agentId ? row.toAgentId : row.fromAgentId;
      if (seen.has(otherAgentId)) continue;
      seen.add(otherAgentId);
      threads.push({ otherAgentId, lastMessage: row });
    }
    return threads;
  }

  async listMachines(): Promise<Machine[]> {
    await initDb();
    const rows = await getDb().select().from(machines).orderBy(asc(machines.connectedAt));
    return rows.map(toMachine);
  }

  async getMachine(id: string): Promise<Machine | undefined> {
    await initDb();
    const [machine] = await getDb().select().from(machines).where(eq(machines.id, id)).limit(1);
    return machine ? toMachine(machine) : undefined;
  }

  async upsertMachine(machine: Machine): Promise<Machine> {
    await initDb();
    await getDb()
      .insert(machines)
      .values({
        ...machine,
        runtimes: JSON.stringify(machine.runtimes),
        runtimeVersions: JSON.stringify(machine.runtimeVersions),
      })
      .onConflictDoUpdate({
        target: machines.id,
        set: {
          hostname: machine.hostname,
          os: machine.os,
          daemonVersion: machine.daemonVersion,
          runtimes: JSON.stringify(machine.runtimes),
          runtimeVersions: JSON.stringify(machine.runtimeVersions),
          status: machine.status,
          connectedAt: machine.connectedAt,
        },
      });
    return machine;
  }

  async mergeMachines(targetMachineId: string, duplicateMachineIds: string[]): Promise<void> {
    await initDb();
    const duplicates = duplicateMachineIds.filter((id) => id !== targetMachineId);
    if (duplicates.length === 0) return;

    await getDb().update(agents).set({ machineId: targetMachineId }).where(inArray(agents.machineId, duplicates));
    await getDb().delete(machines).where(inArray(machines.id, duplicates));
  }

  async setMachineOffline(id: string): Promise<void> {
    await initDb();
    await getDb().update(machines).set({ status: 'offline' }).where(eq(machines.id, id));
  }

  async listAgents(filter: { projectId?: string; role?: AgentRole; capability?: AgentCapability } = {}): Promise<Agent[]> {
    await initDb();
    const rows = await getDb().select().from(agents).orderBy(asc(agents.createdAt));
    let agentList = await this.withAgentPermissions(rows.map(toAgent));
    if (filter.projectId) {
      agentList = agentList.filter((agent) => agent.projectId === filter.projectId);
    }
    if (filter.role) {
      agentList = agentList.filter((agent) => (agent.role ?? 'unassigned') === filter.role);
    }
    if (filter.capability) {
      const capability = filter.capability;
      agentList = agentList.filter((agent) => (agent.capabilities ?? []).includes(capability));
    }
    return agentList;
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    await initDb();
    const [agent] = await getDb().select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) return undefined;
    const parsed = toAgent(agent);
    return { ...parsed, permissions: await this.getAgentPermissions(parsed.id) };
  }

  async getAgentByRuntimeInstanceId(runtimeInstanceId: string): Promise<Agent | undefined> {
    await initDb();
    const [agent] = await getDb()
      .select()
      .from(agents)
      .where(eq(agents.runtimeInstanceId, runtimeInstanceId))
      .limit(1);
    if (!agent) return undefined;
    const parsed = toAgent(agent);
    return { ...parsed, permissions: await this.getAgentPermissions(parsed.id) };
  }

  async findAgentByNameOrId(value: string): Promise<Agent | undefined> {
    await initDb();
    return resolveAgentReference(value, await this.listAgents()).match;
  }

  async resolveAgent(value: string) {
    await initDb();
    return resolveAgentReference(value, await this.listAgents());
  }

  async resolveAgentsByProfile(input: {
    role?: AgentRole;
    capabilities?: AgentCapability[];
    excludeAgentId?: string;
    mustBeIdle?: boolean;
    maxResults?: number;
  }) {
    await initDb();
    return resolveAgents(await this.listAgents(), input);
  }

  async createAgent(agent: Omit<Agent, 'projectId'> & Partial<Pick<Agent, 'projectId'>>): Promise<Agent> {
    await initDb();
    const projectId = agent.projectId ?? DEFAULT_PROJECT_ID;
    const role = agent.role ?? 'unassigned';
    await getDb().insert(agents).values({
      ...agent,
      projectId,
      displayName: agent.displayName ?? null,
      description: agent.description ?? null,
      model: agent.model ?? null,
      systemPrompt: agent.systemPrompt ?? null,
      envVars: agent.envVars ? JSON.stringify(agent.envVars) : null,
      role,
      responsibilities: agent.responsibilities ? JSON.stringify(agent.responsibilities) : null,
      capabilities: agent.capabilities ? JSON.stringify(agent.capabilities) : null,
      workingStyle: agent.workingStyle ?? null,
      handoffPreference: agent.handoffPreference ?? null,
      constraintsText: agent.constraints ? JSON.stringify(agent.constraints) : null,
      examples: agent.examples ? JSON.stringify(agent.examples) : null,
      organization: agent.organization ? JSON.stringify(agent.organization) : null,
      machineId: agent.machineId ?? null,
      runtimeInstanceId: agent.runtimeInstanceId ?? null,
      autoStart: agent.autoStart ?? false,
    });
    const permissions = agent.permissions ?? defaultAgentPermissions();
    await this.setAgentPermissions(agent.id, permissions);
    return {
      ...agent,
      projectId,
      role,
      permissions,
    };
  }

  async getAgentToken(agentId: string): Promise<AgentTokenInfo | undefined> {
    await initDb();
    const [row] = await getDb().select().from(agentTokens).where(eq(agentTokens.agentId, agentId)).limit(1);
    return row ? { agentId: row.agentId, token: row.token, createdAt: row.createdAt } : undefined;
  }

  async getOrCreateAgentToken(agentId: string): Promise<AgentTokenInfo> {
    await initDb();
    const existing = await this.getAgentToken(agentId);
    if (existing) return existing;
    const token = `xox_agent_${crypto.randomUUID().replaceAll('-', '')}`;
    const created: AgentTokenInfo = { agentId, token, createdAt: new Date().toISOString() };
    await getDb().insert(agentTokens).values(created);
    return created;
  }

  async verifyAgentToken(agentId: string, token: string): Promise<boolean> {
    const existing = await this.getAgentToken(agentId);
    return Boolean(existing && existing.token === token);
  }

  async updateAgentStatus(id: string, status: AgentStatus): Promise<Agent | undefined> {
    return this.updateAgent(id, { status });
  }

  async updateAgent(id: string, patch: Partial<Agent>): Promise<Agent | undefined> {
    await initDb();
    const existing = await this.getAgent(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, role: patch.role ?? existing.role ?? 'unassigned' };
    await getDb()
      .update(agents)
      .set({
        name: updated.name,
        displayName: updated.displayName ?? null,
        description: updated.description ?? null,
        runtime: updated.runtime,
        model: updated.model ?? null,
        systemPrompt: updated.systemPrompt ?? null,
        envVars: updated.envVars ? JSON.stringify(updated.envVars) : null,
        role: updated.role ?? 'unassigned',
        responsibilities: updated.responsibilities ? JSON.stringify(updated.responsibilities) : null,
        capabilities: updated.capabilities ? JSON.stringify(updated.capabilities) : null,
        workingStyle: updated.workingStyle ?? null,
        handoffPreference: updated.handoffPreference ?? null,
        constraintsText: updated.constraints ? JSON.stringify(updated.constraints) : null,
        examples: updated.examples ? JSON.stringify(updated.examples) : null,
        organization: updated.organization ? JSON.stringify(updated.organization) : null,
        machineId: updated.machineId ?? null,
        runtimeInstanceId: updated.runtimeInstanceId ?? null,
        status: updated.status,
        autoStart: updated.autoStart ?? false,
        createdAt: updated.createdAt,
      })
      .where(eq(agents.id, id));
    if (patch.permissions) {
      await this.setAgentPermissions(id, patch.permissions);
    }
    updated.permissions = patch.permissions ?? existing.permissions ?? defaultAgentPermissions();
    return updated;
  }

  async setAgentRuntimeInstanceId(id: string, runtimeInstanceId: string): Promise<Agent | undefined> {
    return this.updateAgent(id, { runtimeInstanceId });
  }

  async clearAgentRuntimeInstanceId(id: string): Promise<Agent | undefined> {
    return this.updateAgent(id, { runtimeInstanceId: undefined });
  }

  async deleteAgent(id: string): Promise<Agent | undefined> {
    await initDb();
    const existing = await this.getAgent(id);
    if (!existing) return undefined;
    const database = getDb();
    await database.delete(activities).where(eq(activities.agentId, id));
    await database.delete(agentTokens).where(eq(agentTokens.agentId, id));
    await database.delete(reminders).where(eq(reminders.agentId, id));
    await database.delete(agentPermissions).where(eq(agentPermissions.agentId, id));
    await database.delete(agentDelegations).where(or(eq(agentDelegations.fromAgentId, id), eq(agentDelegations.toAgentId, id)));
    await database.delete(directMessages).where(or(eq(directMessages.fromAgentId, id), eq(directMessages.toAgentId, id)));
    await database.delete(agents).where(eq(agents.id, id));
    return existing;
  }
}

export function getStore(): SqliteStore {
  if (!store) store = new SqliteStore();
  return store;
}

export async function resetStore(): Promise<void> {
  await initDb();
  const database = getDb();
  await database.delete(messages);
  await database.delete(activities);
  await database.delete(directMessages);
  await database.delete(agentDelegations);
  await database.delete(agentTokens);
  await database.delete(auditLogs);
  await database.delete(tasks);
  await database.delete(goals);
  await database.delete(goalAlignments);
  await database.delete(reminders);
  await database.delete(knowledgeEntries);
  await database.delete(decisions);
  await database.delete(documents);
  await database.delete(threadSummaries);
  await database.delete(agentPermissions);
  await database.delete(agents);
  await database.delete(machines);
  await database.delete(channels);
  await database.delete(projects);
  const now = new Date().toISOString();
  await database.insert(projects).values({
    id: DEFAULT_PROJECT_ID,
    name: 'Default Project',
    slug: DEFAULT_PROJECT_ID,
    description: 'Auto-created during v2.2.1 migration',
    paseoProjectId: null,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(channels).values({ id: 'general', projectId: DEFAULT_PROJECT_ID, name: 'general', createdAt: new Date().toISOString() });
}
