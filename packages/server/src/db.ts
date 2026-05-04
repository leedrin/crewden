import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { nanoid } from 'nanoid';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import { asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { Channel, Message, MessageThread, Machine, Agent, RuntimeId, AgentStatus, AgentActivity, DirectMessage, DirectMessageThread, AgentDelegation, AgentTokenInfo, Task, TaskStatus, GoalBrief, GoalBriefStatus, GoalAlignment, GoalAlignmentStatus, Reminder, ReminderStatus, SearchMessageResult, KnowledgeEntry, KnowledgeKind, KnowledgeSearchResult, KnowledgeStatus } from '@crewden/shared';
import { resolveAgentReference } from '@crewden/hub-core';
import { activities, agentDelegations, agentTokens, agents, auditLogs, channels, directMessages, goalAlignments, goals, knowledgeEntries, machines, messages, reminders, tasks } from './schema.js';

type Database = LibSQLDatabase<typeof import('./schema.js')>;

export type AuditLog = {
  id: string;
  actorType: 'user' | 'agent' | 'daemon' | 'system';
  actorId?: string;
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
  db = drizzle(client, { schema: { activities, agentDelegations, agentTokens, agents, auditLogs, channels, directMessages, goalAlignments, goals, knowledgeEntries, machines, messages, reminders, tasks } });
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
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT,
        thread_root_id TEXT,
        mentions TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await database.run(`ALTER TABLE messages ADD COLUMN thread_root_id TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE messages ADD COLUMN mentions TEXT`).catch(() => undefined);
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
        channel_id TEXT NOT NULL,
        message_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        creator_name TEXT NOT NULL,
        assignee_id TEXT,
        context TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await database.run(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
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
    await database.run(`ALTER TABLE tasks ADD COLUMN context TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1`).catch(() => undefined);
    await database.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        runtime TEXT NOT NULL,
        model TEXT,
        system_prompt TEXT,
        env_vars TEXT,
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
    await database.run(`ALTER TABLE agents ADD COLUMN organization TEXT`).catch(() => undefined);
    await database.run(`ALTER TABLE agents ADD COLUMN runtime_instance_id TEXT`).catch(() => undefined);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_agents_runtime_instance_id ON agents(runtime_instance_id)`);
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

    await database
      .insert(channels)
      .values({ id: 'general', name: 'general', createdAt: new Date().toISOString() })
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

function toAgent(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName ?? undefined,
    description: row.description ?? undefined,
    runtime: row.runtime as RuntimeId,
    model: row.model ?? undefined,
    systemPrompt: row.systemPrompt ?? undefined,
    envVars: row.envVars ? JSON.parse(row.envVars) as Record<string, string> : undefined,
    organization: row.organization ? JSON.parse(row.organization) as Agent['organization'] : undefined,
    machineId: row.machineId ?? undefined,
    runtimeInstanceId: row.runtimeInstanceId ?? undefined,
    status: row.status as AgentStatus,
    autoStart: row.autoStart,
    createdAt: row.createdAt,
  };
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    channelId: row.channelId,
    senderName: row.senderName,
    content: row.content,
    agentId: row.agentId ?? undefined,
    threadRootId: row.threadRootId ?? undefined,
    mentions: row.mentions ? JSON.parse(row.mentions) as Message['mentions'] : undefined,
    createdAt: row.createdAt,
  };
}

function withThreadSummary(message: Message, allChannelMessages: Message[]): Message {
  const replies = allChannelMessages.filter((candidate) => candidate.threadRootId === message.id);
  if (replies.length === 0) return message;
  return {
    ...message,
    replyCount: replies.length,
    latestReplyAt: replies.at(-1)?.createdAt,
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
    actorType: row.actorType as AuditLog['actorType'],
    actorId: row.actorId ?? undefined,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    taskId: row.taskId ?? undefined,
    agentId: row.agentId ?? undefined,
    detailJson: JSON.parse(row.detailJson) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

function toTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    channelId: row.channelId,
    messageId: row.messageId ?? undefined,
    title: row.title,
    status: row.status as TaskStatus,
    creatorName: row.creatorName,
    assigneeId: row.assigneeId ?? undefined,
    context: row.context ? JSON.parse(row.context) as Task['context'] : undefined,
    version: row.version ?? 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toGoal(row: typeof goals.$inferSelect): GoalBrief {
  return {
    id: row.id,
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
  async listChannels(): Promise<Channel[]> {
    await initDb();
    return getDb().select().from(channels).orderBy(asc(channels.createdAt));
  }

  async getChannel(id: string): Promise<Channel | undefined> {
    await initDb();
    const [channel] = await getDb().select().from(channels).where(eq(channels.id, id)).limit(1);
    return channel;
  }

  async createChannel(id: string, name: string): Promise<Channel> {
    await initDb();
    const channel: Channel = { id, name, createdAt: new Date().toISOString() };
    await getDb().insert(channels).values(channel);
    return channel;
  }

  async deleteChannel(id: string): Promise<boolean> {
    await initDb();
    const existing = await this.getChannel(id);
    if (!existing) return false;
    await getDb().delete(messages).where(eq(messages.channelId, id));
    await getDb().delete(tasks).where(eq(tasks.channelId, id));
    await getDb().delete(goals).where(eq(goals.channelId, id));
    await getDb().delete(goalAlignments).where(eq(goalAlignments.channelId, id));
    await getDb().delete(reminders).where(eq(reminders.channelId, id));
    await getDb().delete(channels).where(eq(channels.id, id));
    return true;
  }

  async listMessages(channelId: string): Promise<Message[]> {
    await initDb();
    const rows = await getDb().select().from(messages).where(eq(messages.channelId, channelId)).orderBy(asc(messages.createdAt));
    const all = rows.map(toMessage);
    return all.filter((message) => !message.threadRootId).map((message) => withThreadSummary(message, all));
  }

  async listRecentMessages(channelId: string, limit: number): Promise<Message[]> {
    await initDb();
    const rows = await getDb()
      .select()
      .from(messages)
      .where(eq(messages.channelId, channelId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return rows.map(toMessage).reverse();
  }

  async searchMessages(query: string, limit: number): Promise<SearchMessageResult[]> {
    await initDb();
    const needle = query.toLowerCase();
    const channelMap = new Map((await this.listChannels()).map((channel) => [channel.id, channel.name]));
    const rows = await getDb().select().from(messages).orderBy(desc(messages.createdAt)).limit(1000);
    return rows
      .map(toMessage)
      .filter((message) => message.content.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((message) => ({ ...message, channelName: channelMap.get(message.channelId) ?? message.channelId }));
  }

  async createMessage(msg: Omit<Message, 'createdAt'>): Promise<Message> {
    await initDb();
    const message: Message = { ...msg, createdAt: new Date().toISOString() };
    await getDb().insert(messages).values({
      ...message,
      agentId: message.agentId ?? null,
      threadRootId: message.threadRootId ?? null,
      mentions: message.mentions ? JSON.stringify(message.mentions) : null,
    });
    return message;
  }

  async appendMessageContent(id: string, appendText: string): Promise<Message | undefined> {
    await initDb();
    if (!appendText) return this.getMessage(id);
    const [existing] = await getDb().select().from(messages).where(eq(messages.id, id)).limit(1);
    if (!existing) return undefined;
    const nextContent = `${existing.content}${appendText}`;
    await getDb().update(messages).set({ content: nextContent }).where(eq(messages.id, id));
    const [updated] = await getDb().select().from(messages).where(eq(messages.id, id)).limit(1);
    if (!updated) return undefined;
    return toMessage(updated);
  }

  async addMessage(msg: Omit<Message, 'createdAt'>): Promise<Message> {
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
    const [message] = await getDb().select().from(messages).where(eq(messages.id, id)).limit(1);
    if (!message) return undefined;
    const parsed = toMessage(message);
    if (parsed.threadRootId) return parsed;
    const channelMessages = (await getDb().select().from(messages).where(eq(messages.channelId, parsed.channelId)).orderBy(asc(messages.createdAt))).map(toMessage);
    return withThreadSummary(parsed, channelMessages);
  }

  async getThread(rootId: string): Promise<MessageThread | undefined> {
    await initDb();
    const [rootRow] = await getDb().select().from(messages).where(eq(messages.id, rootId)).limit(1);
    if (!rootRow) return undefined;
    const root = toMessage(rootRow);
    const threadRootId = root.threadRootId ?? root.id;
    const [actualRootRow] = await getDb().select().from(messages).where(eq(messages.id, threadRootId)).limit(1);
    if (!actualRootRow) return undefined;
    const actualRoot = toMessage(actualRootRow);
    const replyRows = await getDb()
      .select()
      .from(messages)
      .where(eq(messages.threadRootId, actualRoot.id))
      .orderBy(asc(messages.createdAt));
    const replies = replyRows.map(toMessage);
    return { root: withThreadSummary(actualRoot, [actualRoot, ...replies]), replies };
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

  async appendAuditLog(entry: Omit<AuditLog, 'id' | 'createdAt'> & { id?: string }): Promise<AuditLog> {
    await initDb();
    const created: AuditLog = {
      ...entry,
      id: entry.id ?? nanoid(),
      createdAt: new Date().toISOString(),
    };
    await getDb().insert(auditLogs).values({
      id: created.id,
      actorType: created.actorType,
      actorId: created.actorId ?? null,
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

  async listAuditLogs(filter: { taskId?: string; entityType?: string; entityId?: string } = {}): Promise<AuditLog[]> {
    await initDb();
    const rows = await getDb().select().from(auditLogs).orderBy(asc(auditLogs.createdAt));
    return rows
      .map(toAuditLog)
      .filter((entry) =>
        (!filter.taskId || entry.taskId === filter.taskId) &&
        (!filter.entityType || entry.entityType === filter.entityType) &&
        (!filter.entityId || entry.entityId === filter.entityId)
      );
  }

  async listTasks(filter: { channelId?: string; status?: TaskStatus; assigneeId?: string } = {}): Promise<Task[]> {
    await initDb();
    const rows = await getDb().select().from(tasks).orderBy(asc(tasks.createdAt));
    return rows
      .map(toTask)
      .filter((task) =>
        (!filter.channelId || task.channelId === filter.channelId) &&
        (!filter.status || task.status === filter.status) &&
        (!filter.assigneeId || task.assigneeId === filter.assigneeId)
      );
  }

  async getTask(id: string): Promise<Task | undefined> {
    await initDb();
    const [task] = await getDb().select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return task ? toTask(task) : undefined;
  }

  async createTask(task: Omit<Task, 'createdAt' | 'updatedAt' | 'version'>): Promise<Task> {
    await initDb();
    const now = new Date().toISOString();
    const created: Task = { ...task, title: task.title.slice(0, 200), version: 1, createdAt: now, updatedAt: now };
    await getDb().insert(tasks).values({
      ...created,
      messageId: created.messageId ?? null,
      assigneeId: created.assigneeId ?? null,
      context: created.context ? JSON.stringify(created.context) : null,
    });
    return created;
  }

  async updateTask(id: string, patch: Partial<Pick<Task, 'status' | 'assigneeId' | 'context'>>): Promise<Task | undefined> {
    await initDb();
    const existing = await this.getTask(id);
    if (!existing) return undefined;
    const updated: Task = { ...existing, ...patch, version: existing.version + 1, updatedAt: new Date().toISOString() };
    await getDb()
      .update(tasks)
      .set({
        status: updated.status,
        assigneeId: updated.assigneeId ?? null,
        context: updated.context ? JSON.stringify(updated.context) : null,
        version: updated.version,
        updatedAt: updated.updatedAt,
      })
      .where(eq(tasks.id, id));
    return updated;
  }

  async deleteTask(id: string): Promise<boolean> {
    await initDb();
    const existing = await this.getTask(id);
    if (!existing) return false;
    await getDb().delete(tasks).where(eq(tasks.id, id));
    return true;
  }

  async listGoals(filter: { channelId?: string; status?: GoalBriefStatus } = {}): Promise<GoalBrief[]> {
    await initDb();
    const rows = await getDb().select().from(goals).orderBy(asc(goals.createdAt));
    return rows
      .map(toGoal)
      .filter((goal) =>
        (!filter.channelId || goal.channelId === filter.channelId) &&
        (!filter.status || goal.status === filter.status)
      );
  }

  async getGoal(id: string): Promise<GoalBrief | undefined> {
    await initDb();
    const [goal] = await getDb().select().from(goals).where(eq(goals.id, id)).limit(1);
    return goal ? toGoal(goal) : undefined;
  }

  async createGoal(goal: Omit<GoalBrief, 'createdAt' | 'updatedAt'>): Promise<GoalBrief> {
    await initDb();
    const now = new Date().toISOString();
    const created: GoalBrief = { ...goal, createdAt: now, updatedAt: now };
    await getDb().insert(goals).values({
      ...created,
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

  async listGoalAlignments(filter: { channelId?: string; status?: GoalAlignmentStatus } = {}): Promise<GoalAlignment[]> {
    await initDb();
    const rows = await getDb().select().from(goalAlignments).orderBy(asc(goalAlignments.createdAt));
    return rows
      .map(toGoalAlignment)
      .filter((alignment) =>
        (!filter.channelId || alignment.channelId === filter.channelId) &&
        (!filter.status || alignment.status === filter.status)
      );
  }

  async getGoalAlignment(id: string): Promise<GoalAlignment | undefined> {
    await initDb();
    const [alignment] = await getDb().select().from(goalAlignments).where(eq(goalAlignments.id, id)).limit(1);
    return alignment ? toGoalAlignment(alignment) : undefined;
  }

  async createGoalAlignment(alignment: Omit<GoalAlignment, 'createdAt' | 'updatedAt'>): Promise<GoalAlignment> {
    await initDb();
    const now = new Date().toISOString();
    const created: GoalAlignment = { ...alignment, createdAt: now, updatedAt: now };
    await getDb().insert(goalAlignments).values({
      ...created,
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

  async listReminders(agentId?: string): Promise<Reminder[]> {
    await initDb();
    const rows = await getDb().select().from(reminders).orderBy(asc(reminders.triggerAt));
    return rows.map(toReminder).filter((reminder) => !agentId || reminder.agentId === agentId);
  }

  async listDueReminders(nowIso: string): Promise<Reminder[]> {
    return (await this.listReminders()).filter((reminder) => reminder.status === 'pending' && reminder.triggerAt <= nowIso);
  }

  async getReminder(id: string): Promise<Reminder | undefined> {
    await initDb();
    const [reminder] = await getDb().select().from(reminders).where(eq(reminders.id, id)).limit(1);
    return reminder ? toReminder(reminder) : undefined;
  }

  async createReminder(reminder: Omit<Reminder, 'createdAt'>): Promise<Reminder> {
    await initDb();
    const created: Reminder = { ...reminder, createdAt: new Date().toISOString() };
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

  async searchKnowledge(filter: { query?: string; kind?: KnowledgeKind; tags?: string[]; limit?: number } = {}): Promise<KnowledgeSearchResult[]> {
    await initDb();
    const rows = await getDb().select().from(knowledgeEntries).orderBy(desc(knowledgeEntries.updatedAt));
    const query = (filter.query ?? '').trim().toLowerCase();
    const tags = filter.tags ?? [];
    return rows
      .map(toKnowledgeEntry)
      .map((entry) => ({ entry, score: scoreKnowledge(entry, query), reason: query ? `Matched "${query}"` : 'Recent knowledge' }))
      .filter((result) => (!filter.kind || result.entry.kind === filter.kind) && tags.every((tag) => result.entry.tags.includes(tag)))
      .filter((result) => !query || result.score > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || new Date(b.entry.updatedAt).getTime() - new Date(a.entry.updatedAt).getTime())
      .slice(0, filter.limit ?? 20);
  }

  async getKnowledgeEntry(id: string): Promise<KnowledgeEntry | undefined> {
    await initDb();
    const [entry] = await getDb().select().from(knowledgeEntries).where(eq(knowledgeEntries.id, id)).limit(1);
    return entry ? toKnowledgeEntry(entry) : undefined;
  }

  async createKnowledgeEntry(entry: Omit<KnowledgeEntry, 'createdAt' | 'updatedAt'>): Promise<KnowledgeEntry> {
    await initDb();
    const now = new Date().toISOString();
    const created: KnowledgeEntry = { ...entry, createdAt: now, updatedAt: now };
    await getDb().insert(knowledgeEntries).values({
      ...created,
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

  async listAgents(): Promise<Agent[]> {
    await initDb();
    const rows = await getDb().select().from(agents).orderBy(asc(agents.createdAt));
    return rows.map(toAgent);
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    await initDb();
    const [agent] = await getDb().select().from(agents).where(eq(agents.id, id)).limit(1);
    return agent ? toAgent(agent) : undefined;
  }

  async getAgentByRuntimeInstanceId(runtimeInstanceId: string): Promise<Agent | undefined> {
    await initDb();
    const [agent] = await getDb()
      .select()
      .from(agents)
      .where(eq(agents.runtimeInstanceId, runtimeInstanceId))
      .limit(1);
    return agent ? toAgent(agent) : undefined;
  }

  async findAgentByNameOrId(value: string): Promise<Agent | undefined> {
    await initDb();
    return resolveAgentReference(value, await this.listAgents()).match;
  }

  async resolveAgent(value: string) {
    await initDb();
    return resolveAgentReference(value, await this.listAgents());
  }

  async createAgent(agent: Agent): Promise<Agent> {
    await initDb();
    await getDb().insert(agents).values({
      ...agent,
      displayName: agent.displayName ?? null,
      description: agent.description ?? null,
      model: agent.model ?? null,
      systemPrompt: agent.systemPrompt ?? null,
      envVars: agent.envVars ? JSON.stringify(agent.envVars) : null,
      organization: agent.organization ? JSON.stringify(agent.organization) : null,
      machineId: agent.machineId ?? null,
      runtimeInstanceId: agent.runtimeInstanceId ?? null,
      autoStart: agent.autoStart ?? false,
    });
    return agent;
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
    const updated = { ...existing, ...patch };
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
        organization: updated.organization ? JSON.stringify(updated.organization) : null,
        machineId: updated.machineId ?? null,
        runtimeInstanceId: updated.runtimeInstanceId ?? null,
        status: updated.status,
        autoStart: updated.autoStart ?? false,
        createdAt: updated.createdAt,
      })
      .where(eq(agents.id, id));
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
  await database.delete(agents);
  await database.delete(machines);
  await database.delete(channels);
  await database.insert(channels).values({ id: 'general', name: 'general', createdAt: new Date().toISOString() });
}
