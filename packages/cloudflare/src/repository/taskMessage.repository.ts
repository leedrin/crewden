import type {
  ActorType,
  Channel,
  Decision,
  DecisionStatus,
  Document,
  DocumentKind,
  DocumentStatus,
  Message,
  Task,
  TaskStatus,
} from '@crewden/shared';
import type { NewMessage, NewTask, Row, SqlStorage, TaskMessageRepository, TaskPatch, ThreadView } from './types.js';

function parseStringArray(value: unknown): string[] | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
}

function normalizeTaskStatus(status: string): TaskStatus {
  if (status === 'todo') return 'backlog';
  if (status === 'blocked') return 'in_progress';
  return status as TaskStatus;
}

function normalizeDecisionStatus(status: string): DecisionStatus {
  if (status === 'accepted' || status === 'deprecated' || status === 'superseded') return status;
  return 'proposed';
}

function normalizeDocumentStatus(status: string): DocumentStatus {
  if (status === 'in_review' || status === 'approved' || status === 'deprecated' || status === 'superseded') return status;
  return 'draft';
}

function toChannel(row: Row): Channel {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
  };
}

function toMessage(row: Row): Message {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    senderName: String(row.sender_name),
    content: String(row.content),
    agentId: row.agent_id ? String(row.agent_id) : undefined,
    actorType: String(row.actor_type ?? (row.agent_id ? 'agent' : 'human')) as ActorType,
    actorId: String(row.actor_id ?? row.agent_id ?? row.sender_name),
    threadRootId: row.thread_root_id ? String(row.thread_root_id) : undefined,
    mentions: row.mentions ? JSON.parse(String(row.mentions)) as Message['mentions'] : undefined,
    createdAt: String(row.created_at),
  };
}

function toTask(row: Row): Task {
  const context = row.context ? JSON.parse(String(row.context)) as Task['context'] : undefined;
  const ownerId = row.owner_id ? String(row.owner_id) : row.assignee_id ? String(row.assignee_id) : undefined;
  const reviewerId = row.reviewer_id ? String(row.reviewer_id) : context?.reviewerAgentId;
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    messageId: row.message_id ? String(row.message_id) : undefined,
    title: String(row.title),
    status: normalizeTaskStatus(String(row.status)),
    type: String(row.type ?? 'feature') as Task['type'],
    creatorName: String(row.creator_name),
    creator: {
      actorType: String(row.creator_type ?? 'human') as ActorType,
      actorId: String(row.creator_id ?? row.creator_name),
    },
    assigneeId: row.assignee_id ? String(row.assignee_id) : undefined,
    owner: ownerId ? { actorType: String(row.owner_type ?? 'agent') as ActorType, actorId: ownerId } : undefined,
    reviewer: reviewerId ? { actorType: String(row.reviewer_type ?? 'agent') as ActorType, actorId: reviewerId } : undefined,
    acceptanceCriteria: parseStringArray(row.acceptance_criteria),
    definitionOfDone: parseStringArray(row.definition_of_done),
    constraints: parseStringArray(row.constraints),
    dependsOn: parseStringArray(row.depends_on),
    isBlocked: Boolean(Number(row.is_blocked ?? 0)),
    blockedReason: row.blocked_reason ? String(row.blocked_reason) : context?.blockedReason,
    sourceChannelId: row.source_channel_id ? String(row.source_channel_id) : undefined,
    sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : undefined,
    context,
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toDecision(row: Row): Decision {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : undefined,
    title: String(row.title),
    status: normalizeDecisionStatus(String(row.status)),
    problem: String(row.problem),
    alternatives: parseStringArray(row.alternatives),
    decisionText: String(row.decision_text),
    rationale: row.rationale ? String(row.rationale) : undefined,
    consequences: parseStringArray(row.consequences),
    participants: row.participants ? JSON.parse(String(row.participants)) as Decision['participants'] : undefined,
    relatedDecisions: parseStringArray(row.related_decisions),
    supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toDocument(row: Row): Document {
  return {
    id: String(row.id),
    kind: String(row.kind) as DocumentKind,
    title: String(row.title),
    status: normalizeDocumentStatus(String(row.status)),
    content: String(row.content),
    sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : undefined,
    sourceChannelId: String(row.source_channel_id),
    author: {
      actorType: String(row.author_type) as ActorType,
      actorId: String(row.author_id),
    },
    authorName: String(row.author_name),
    reviewers: row.reviewers ? JSON.parse(String(row.reviewers)) as Document['reviewers'] : undefined,
    relatedDecisions: parseStringArray(row.related_decisions),
    relatedTasks: parseStringArray(row.related_tasks),
    supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
    approvedAt: row.approved_at ? String(row.approved_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SqliteTaskMessageRepository implements TaskMessageRepository {
  constructor(private sql: SqlStorage) {}

  getChannel(id: string): Channel | undefined {
    const row = this.sql.exec<Row>('SELECT id, name, created_at FROM channels WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toChannel(row) : undefined;
  }

  listChannels(): Channel[] {
    return this.sql.exec<Row>('SELECT id, name, created_at FROM channels ORDER BY created_at').toArray().map(toChannel);
  }

  findChannel(value: string): Channel | undefined {
    const byId = this.getChannel(value);
    if (byId) return byId;
    return this.listChannels().find((channel) => channel.name === value);
  }

  withThreadSummary(message: Message, channelMessages?: Message[]): Message {
    const candidates = channelMessages ?? this.sql
      .exec<Row>('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at', message.channelId)
      .toArray()
      .map(toMessage);
    const replies = candidates.filter((candidate) => candidate.threadRootId === message.id);
    if (replies.length === 0) return message;
    return {
      ...message,
      replyCount: replies.length,
      latestReplyAt: replies.at(-1)?.createdAt,
    };
  }

  getMessage(id: string): Message | undefined {
    const row = this.sql.exec<Row>('SELECT * FROM messages WHERE id = ? LIMIT 1', id).toArray()[0];
    if (!row) return undefined;
    const message = toMessage(row);
    if (message.threadRootId) return message;
    return this.withThreadSummary(message);
  }

  listMessages(channelId: string): Message[] {
    const all = this.sql
      .exec<Row>('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at', channelId)
      .toArray()
      .map(toMessage);
    return all.filter((message) => !message.threadRootId).map((message) => this.withThreadSummary(message, all));
  }

  listRecentMessages(channelId: string, limit: number): Message[] {
    return this.sql
      .exec<Row>('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?', channelId, limit)
      .toArray()
      .map(toMessage)
      .reverse();
  }

  searchMessages(query: string, limit: number): Array<Message & { channelName: string }> {
    const needle = query.toLowerCase();
    const channelMap = new Map(this.listChannels().map((channel) => [channel.id, channel.name]));
    return this.sql
      .exec<Row>('SELECT * FROM messages ORDER BY created_at DESC LIMIT 1000')
      .toArray()
      .map(toMessage)
      .filter((message) => message.content.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((message) => ({ ...message, channelName: channelMap.get(message.channelId) ?? message.channelId }));
  }

  getThread(messageId: string): ThreadView | undefined {
    const message = this.getMessage(messageId);
    if (!message) return undefined;
    const rootId = message.threadRootId ?? message.id;
    const rootRow = this.sql.exec<Row>('SELECT * FROM messages WHERE id = ? LIMIT 1', rootId).toArray()[0];
    if (!rootRow) return undefined;
    const root = toMessage(rootRow);
    const replies = this.sql
      .exec<Row>('SELECT * FROM messages WHERE thread_root_id = ? ORDER BY created_at', root.id)
      .toArray()
      .map(toMessage);
    const linkedDecisions = this.sql
      .exec<Row>('SELECT * FROM decisions WHERE source_thread_id = ? ORDER BY updated_at DESC', root.id)
      .toArray()
      .map(toDecision);
    const linkedDocuments = this.sql
      .exec<Row>('SELECT * FROM documents WHERE source_thread_id = ? ORDER BY updated_at DESC', root.id)
      .toArray()
      .map(toDocument);
    return { root: this.withThreadSummary(root, [root, ...replies]), replies, linkedDecisions, linkedDocuments };
  }

  listTasks(filter: { channelId?: string; status?: TaskStatus; assigneeId?: string } = {}): Task[] {
    return this.sql
      .exec<Row>('SELECT * FROM tasks ORDER BY created_at')
      .toArray()
      .map(toTask)
      .filter((task) =>
        (!filter.channelId || task.channelId === filter.channelId) &&
        (!filter.status || task.status === filter.status) &&
        (!filter.assigneeId || task.assigneeId === filter.assigneeId)
      );
  }

  getTask(id: string): Task | undefined {
    const row = this.sql.exec<Row>('SELECT * FROM tasks WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toTask(row) : undefined;
  }

  createMessage(message: NewMessage): Message {
    const created: Message = {
      ...message,
      actorType: message.actorType ?? (message.agentId ? 'agent' : 'human'),
      actorId: message.actorId ?? message.agentId ?? message.senderName,
      createdAt: new Date().toISOString(),
    };
    this.sql.exec(
      `INSERT INTO messages (id, channel_id, sender_name, content, agent_id, actor_type, actor_id, thread_root_id, mentions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.channelId,
      created.senderName,
      created.content,
      created.agentId ?? null,
      created.actorType,
      created.actorId,
      created.threadRootId ?? null,
      created.mentions ? JSON.stringify(created.mentions) : null,
      created.createdAt
    );
    return created;
  }

  createTask(task: NewTask): Task {
    const now = new Date().toISOString();
    const owner = task.owner ?? (task.assigneeId ? { actorType: 'agent' as const, actorId: task.assigneeId } : undefined);
    const created: Task = {
      ...task,
      title: task.title.slice(0, 200),
      status: normalizeTaskStatus(task.status),
      type: task.type ?? 'feature',
      creator: task.creator ?? { actorType: 'human', actorId: task.creatorName },
      owner,
      assigneeId: task.assigneeId ?? (owner?.actorType === 'agent' ? owner.actorId : undefined),
      isBlocked: task.isBlocked ?? false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.sql.exec(
      `INSERT INTO tasks (id, channel_id, message_id, title, status, type, creator_name, creator_type, creator_id, assignee_id, owner_type, owner_id, reviewer_type, reviewer_id, acceptance_criteria, definition_of_done, constraints, depends_on, is_blocked, blocked_reason, source_channel_id, source_thread_id, context, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.channelId,
      created.messageId ?? null,
      created.title,
      created.status,
      created.type,
      created.creatorName,
      created.creator.actorType,
      created.creator.actorId,
      created.assigneeId ?? null,
      created.owner?.actorType ?? null,
      created.owner?.actorId ?? null,
      created.reviewer?.actorType ?? null,
      created.reviewer?.actorId ?? null,
      created.acceptanceCriteria ? JSON.stringify(created.acceptanceCriteria) : null,
      created.definitionOfDone ? JSON.stringify(created.definitionOfDone) : null,
      created.constraints ? JSON.stringify(created.constraints) : null,
      created.dependsOn ? JSON.stringify(created.dependsOn) : null,
      created.isBlocked ? 1 : 0,
      created.blockedReason ?? null,
      created.sourceChannelId ?? null,
      created.sourceThreadId ?? null,
      created.context ? JSON.stringify(created.context) : null,
      created.version,
      created.createdAt,
      created.updatedAt
    );
    return created;
  }

  updateTask(id: string, patch: TaskPatch): Task | undefined {
    const existing = this.getTask(id);
    if (!existing) return undefined;
    const owner = patch.owner ?? (patch.assigneeId ? { actorType: 'agent' as const, actorId: patch.assigneeId } : undefined);
    const updated: Task = {
      ...existing,
      ...patch,
      status: patch.status ? normalizeTaskStatus(patch.status) : existing.status,
      owner: owner ?? patch.owner ?? existing.owner,
      assigneeId: patch.assigneeId ?? (owner?.actorType === 'agent' ? owner.actorId : existing.assigneeId),
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.sql.exec(
      `UPDATE tasks
       SET status = ?, assignee_id = ?, owner_type = ?, owner_id = ?, reviewer_type = ?, reviewer_id = ?,
           acceptance_criteria = ?, definition_of_done = ?, constraints = ?, depends_on = ?,
           is_blocked = ?, blocked_reason = ?, context = ?, version = ?, updated_at = ?
       WHERE id = ?`,
      updated.status,
      updated.assigneeId ?? null,
      updated.owner?.actorType ?? null,
      updated.owner?.actorId ?? null,
      updated.reviewer?.actorType ?? null,
      updated.reviewer?.actorId ?? null,
      updated.acceptanceCriteria ? JSON.stringify(updated.acceptanceCriteria) : null,
      updated.definitionOfDone ? JSON.stringify(updated.definitionOfDone) : null,
      updated.constraints ? JSON.stringify(updated.constraints) : null,
      updated.dependsOn ? JSON.stringify(updated.dependsOn) : null,
      updated.isBlocked ? 1 : 0,
      updated.blockedReason ?? null,
      updated.context ? JSON.stringify(updated.context) : null,
      updated.version,
      updated.updatedAt,
      id,
    );
    return updated;
  }

  addContextPackageRef(taskId: string, refType: string, refId: string, refUpdatedAt: string): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO context_package_refs (task_id, ref_type, ref_id, ref_updated_at) VALUES (?, ?, ?, ?)',
      taskId, refType, refId, refUpdatedAt,
    );
  }

  removeContextPackageRefsForTask(taskId: string): void {
    this.sql.exec('DELETE FROM context_package_refs WHERE task_id = ?', taskId);
  }

  findTaskIdsByRef(refType: string, refId: string): string[] {
    const cursor = this.sql.exec('SELECT task_id FROM context_package_refs WHERE ref_type = ? AND ref_id = ?', refType, refId);
    return Array.from(cursor).map((row) => String(row.task_id));
  }

  markContextPackagesStale(refType: string, refId: string): number {
    const taskIds = this.findTaskIdsByRef(refType, refId);
    for (const taskId of taskIds) {
      const task = this.getTask(taskId);
      if (task?.context?.contextPackage && !task.context.contextPackage.stale) {
        task.context.contextPackage.stale = true;
        task.context.contextPackage.staleReason = `${refType} updated: ${refId}`;
        this.updateTask(taskId, { context: task.context });
      }
    }
    return taskIds.length;
  }
}
