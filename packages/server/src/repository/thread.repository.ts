import { asc, eq, or } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { ActorType, Decision, DecisionStatus, Document, DocumentKind, DocumentStatus, Message, MessageIntent, MessageThread, ThreadParticipant, ThreadStatus } from '@crewden/shared';
import { decisions, documents, messages, tasks, threadSummaries } from '../schema.js';
import type { ThreadRepository, ThreadSummaryRow } from './types.js';

type Database = LibSQLDatabase<typeof import('../schema.js')>;

const DEFAULT_PROJECT_ID = 'default';

function parseStringArray(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
}

function parseParticipants(value: string | null): ThreadParticipant[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is ThreadParticipant =>
      Boolean(item) &&
      typeof item === 'object' &&
      (((item as ThreadParticipant).actorType === 'human') ||
        ((item as ThreadParticipant).actorType === 'agent') ||
        ((item as ThreadParticipant).actorType === 'system')) &&
      typeof (item as ThreadParticipant).actorId === 'string' &&
      (item as ThreadParticipant).actorId.length > 0,
  );
}

function normalizeMessageIntent(value: string | null | undefined): MessageIntent {
  if (value === 'goal' || value === 'task' || value === 'chat') return value;
  return 'chat';
}

function normalizeDecisionStatus(status: string): DecisionStatus {
  if (status === 'accepted' || status === 'deprecated' || status === 'superseded') return status;
  return 'proposed';
}

function normalizeDocumentStatus(status: string): DocumentStatus {
  if (status === 'in_review' || status === 'approved' || status === 'deprecated' || status === 'superseded') return status;
  return 'draft';
}

function normalizeThreadStatus(status: string | null | undefined): ThreadStatus {
  if (status === 'resolved' || status === 'archived') return status;
  return 'active';
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    channelId: row.channelId,
    senderName: row.senderName,
    content: row.content,
    agentId: row.agentId ?? undefined,
    actorType: row.actorType as ActorType,
    actorId: row.actorId ?? row.agentId ?? row.senderName,
    threadRootId: row.threadRootId ?? undefined,
    intent: normalizeMessageIntent(row.intent),
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

function toThreadSummary(row: typeof threadSummaries.$inferSelect): ThreadSummaryRow {
  return {
    threadRootId: row.threadRootId,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    title: row.title ?? undefined,
    status: normalizeThreadStatus(row.status),
    summaryContent: row.summaryContent ?? undefined,
    summaryGeneratedAt: row.summaryGeneratedAt ?? undefined,
    linkedDecisions: parseStringArray(row.linkedDecisions) ?? [],
    linkedDocuments: parseStringArray(row.linkedDocuments) ?? [],
    linkedTasks: parseStringArray(row.linkedTasks) ?? [],
    messageCount: row.messageCount ?? 0,
    participants: parseParticipants(row.participants),
    createdAt: row.createdAt ?? undefined,
    resolvedAt: row.resolvedAt ?? undefined,
  };
}

export class SqliteThreadRepository implements ThreadRepository {
  constructor(private db: Database) {}

  async getSummary(rootId: string): Promise<ThreadSummaryRow | undefined> {
    const [row] = await this.db.select().from(threadSummaries).where(eq(threadSummaries.threadRootId, rootId)).limit(1);
    return row ? toThreadSummary(row) : undefined;
  }

  async setThreadStatus(rootId: string, status: ThreadStatus): Promise<ThreadSummaryRow | undefined> {
    return this.refreshSummary(rootId, { status, forceSummary: status === 'resolved' });
  }

  private deriveThreadTitle(content: string): string {
    const compact = content.replace(/\s+/g, ' ').trim();
    if (!compact) return 'Thread';
    return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
  }

  private buildThreadSummaryContent(root: Message, replies: Message[]): string {
    const allMessages = [root, ...replies];
    const tail = allMessages.slice(-10);
    const participants = Array.from(new Set(allMessages.map((message) => `${message.senderName}(${message.actorType})`)));
    const points = tail
      .map((message) => message.content.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 5);
    const decisions = tail
      .map((message) => message.content.trim())
      .filter((line) => /(决定|采用|结论|final|decid|will use|agreed)/i.test(line))
      .slice(0, 3);
    const questions = tail
      .map((message) => message.content.trim())
      .filter((line) => /[?？]/.test(line))
      .slice(0, 3);

    const summaryLines = [
      `# ${this.deriveThreadTitle(root.content)}`,
      `Participants: ${participants.join(', ') || 'n/a'}`,
      'Key points:',
      ...(points.length ? points.map((point) => `- ${point}`) : ['- n/a']),
      'Decisions:',
      ...(decisions.length ? decisions.map((line) => `- ${line}`) : ['- n/a']),
      'Open questions:',
      ...(questions.length ? questions.map((line) => `- ${line}`) : ['- n/a']),
    ];
    return summaryLines.join('\n');
  }

  async refreshSummary(
    rootId: string,
    options: { status?: ThreadStatus; forceSummary?: boolean } = {},
  ): Promise<ThreadSummaryRow | undefined> {
    const [rootRow] = await this.db.select().from(messages).where(eq(messages.id, rootId)).limit(1);
    if (!rootRow) return undefined;

    const root = toMessage(rootRow);
    const replyRows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.threadRootId, root.id))
      .orderBy(asc(messages.createdAt));
    const replies = replyRows.map(toMessage);
    const now = new Date().toISOString();
    const messageCount = 1 + replies.length;
    const participants = Array.from(
      new Map([root, ...replies].map((message) => [`${message.actorType}:${message.actorId}`, { actorType: message.actorType, actorId: message.actorId }])).values(),
    );
    const [existingRow] = await this.db.select().from(threadSummaries).where(eq(threadSummaries.threadRootId, root.id)).limit(1);
    const existing = existingRow ? toThreadSummary(existingRow) : undefined;
    const status = options.status ?? existing?.status ?? 'active';
    const shouldGenerateSummary = options.forceSummary || messageCount > 10;
    const summaryContent = shouldGenerateSummary
      ? this.buildThreadSummaryContent(root, replies)
      : existing?.summaryContent;
    const summaryGeneratedAt = shouldGenerateSummary ? now : existing?.summaryGeneratedAt;
    const resolvedAt = status === 'resolved'
      ? (existing?.resolvedAt ?? now)
      : (options.status === 'active' ? undefined : existing?.resolvedAt);

    const linkedDecisionRows = await this.db.select({ id: decisions.id }).from(decisions).where(eq(decisions.sourceThreadId, root.id));
    const linkedDocumentRows = await this.db.select({ id: documents.id }).from(documents).where(eq(documents.sourceThreadId, root.id));
    const linkedTaskRows = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(or(eq(tasks.sourceThreadId, root.id), eq(tasks.messageId, root.id)));

    const payload: ThreadSummaryRow = {
      threadRootId: root.id,
      projectId: root.projectId ?? DEFAULT_PROJECT_ID,
      title: existing?.title ?? this.deriveThreadTitle(root.content),
      status,
      summaryContent,
      summaryGeneratedAt,
      linkedDecisions: linkedDecisionRows.map((row) => row.id),
      linkedDocuments: linkedDocumentRows.map((row) => row.id),
      linkedTasks: linkedTaskRows.map((row) => row.id),
      messageCount,
      participants,
      createdAt: existing?.createdAt ?? root.createdAt,
      resolvedAt,
    };

    if (existingRow) {
      await this.db.update(threadSummaries).set({
        projectId: payload.projectId,
        title: payload.title ?? null,
        status: payload.status,
        summaryContent: payload.summaryContent ?? null,
        summaryGeneratedAt: payload.summaryGeneratedAt ?? null,
        linkedDecisions: JSON.stringify(payload.linkedDecisions),
        linkedDocuments: JSON.stringify(payload.linkedDocuments),
        linkedTasks: JSON.stringify(payload.linkedTasks),
        messageCount: payload.messageCount,
        participants: JSON.stringify(payload.participants),
        createdAt: payload.createdAt ?? null,
        resolvedAt: payload.resolvedAt ?? null,
      }).where(eq(threadSummaries.threadRootId, root.id));
    } else {
      await this.db.insert(threadSummaries).values({
        threadRootId: payload.threadRootId,
        projectId: payload.projectId,
        title: payload.title ?? null,
        status: payload.status,
        summaryContent: payload.summaryContent ?? null,
        summaryGeneratedAt: payload.summaryGeneratedAt ?? null,
        linkedDecisions: JSON.stringify(payload.linkedDecisions),
        linkedDocuments: JSON.stringify(payload.linkedDocuments),
        linkedTasks: JSON.stringify(payload.linkedTasks),
        messageCount: payload.messageCount,
        participants: JSON.stringify(payload.participants),
        createdAt: payload.createdAt ?? null,
        resolvedAt: payload.resolvedAt ?? null,
      });
    }

    return payload;
  }

  async getThread(rootId: string): Promise<MessageThread | undefined> {
    const [rootRow] = await this.db.select().from(messages).where(eq(messages.id, rootId)).limit(1);
    if (!rootRow) return undefined;
    const root = toMessage(rootRow);
    const threadRootId = root.threadRootId ?? root.id;
    const [actualRootRow] = await this.db.select().from(messages).where(eq(messages.id, threadRootId)).limit(1);
    if (!actualRootRow) return undefined;
    const actualRoot = toMessage(actualRootRow);
    const replyRows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.threadRootId, actualRoot.id))
      .orderBy(asc(messages.createdAt));
    const replies = replyRows.map(toMessage);
    const linkedDecisions = (await this.db.select().from(decisions).where(eq(decisions.sourceThreadId, actualRoot.id)))
      .map(toDecision)
      .filter((decision) => decision.projectId === actualRoot.projectId);
    const linkedDocuments = (await this.db.select().from(documents).where(eq(documents.sourceThreadId, actualRoot.id)))
      .map(toDocument)
      .filter((document) => document.projectId === actualRoot.projectId);
    const summary = await this.refreshSummary(actualRoot.id);
    return {
      root: withThreadSummary(actualRoot, [actualRoot, ...replies]),
      replies,
      title: summary?.title,
      status: summary?.status ?? 'active',
      summaryContent: summary?.summaryContent,
      summaryGeneratedAt: summary?.summaryGeneratedAt,
      messageCount: summary?.messageCount ?? (1 + replies.length),
      participants: summary?.participants ?? [],
      resolvedAt: summary?.resolvedAt,
      linkedDecisions,
      linkedDocuments,
    };
  }
}
