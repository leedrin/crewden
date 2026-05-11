import { asc, desc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { ActorType, Message, MessageIntent, SearchMessageResult } from '@crewden/shared';
import { classifyMessageIntent } from '@crewden/hub-core';
import { channels, messages } from '../schema.js';
import type { MessageRepository, NewMessage } from './types.js';

type Database = LibSQLDatabase<typeof import('../schema.js')>;

const DEFAULT_PROJECT_ID = 'default';

function normalizeMessageIntent(value: string | null | undefined): MessageIntent {
  if (value === 'goal' || value === 'task' || value === 'chat') return value;
  return 'chat';
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

export class SqliteMessageRepository implements MessageRepository {
  constructor(private db: Database) {}

  async listByChannel(channelId: string): Promise<Message[]> {
    const rows = await this.db.select().from(messages).where(eq(messages.channelId, channelId)).orderBy(asc(messages.createdAt));
    const all = rows.map(toMessage);
    return all.filter((message) => !message.threadRootId).map((message) => withThreadSummary(message, all));
  }

  async listRecent(channelId: string, limit: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.channelId, channelId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return rows.map(toMessage).reverse();
  }

  async search(query: string, limit: number, projectId?: string): Promise<SearchMessageResult[]> {
    const needle = query.toLowerCase();
    const channelRows = await this.db.select().from(channels);
    const channelMap = new Map(channelRows.map((channel) => [channel.id, channel.name]));
    const rows = await this.db.select().from(messages).orderBy(desc(messages.createdAt)).limit(1000);
    return rows
      .map(toMessage)
      .filter((message) => !projectId || message.projectId === projectId)
      .filter((message) => message.content.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((message) => ({ ...message, channelName: channelMap.get(message.channelId) ?? message.channelId }));
  }

  async getById(id: string): Promise<Message | undefined> {
    const [message] = await this.db.select().from(messages).where(eq(messages.id, id)).limit(1);
    if (!message) return undefined;
    const parsed = toMessage(message);
    if (parsed.threadRootId) return parsed;
    const channelRows = await this.db.select().from(messages).where(eq(messages.channelId, parsed.channelId)).orderBy(asc(messages.createdAt));
    return withThreadSummary(parsed, channelRows.map(toMessage));
  }

  async create(msg: NewMessage): Promise<Message> {
    const intent = msg.intent ?? classifyMessageIntent({ content: msg.content });
    const message: Message = {
      ...msg,
      projectId: msg.projectId ?? DEFAULT_PROJECT_ID,
      actorType: msg.actorType ?? (msg.agentId ? 'agent' : 'human'),
      actorId: msg.actorId ?? msg.agentId ?? msg.senderName,
      intent,
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(messages).values({
      ...message,
      agentId: message.agentId ?? null,
      actorId: message.actorId,
      threadRootId: message.threadRootId ?? null,
      intent: message.intent ?? 'chat',
      mentions: message.mentions ? JSON.stringify(message.mentions) : null,
    });
    return message;
  }

  async appendContent(id: string, appendText: string): Promise<Message | undefined> {
    if (!appendText) return this.getById(id);
    const [existing] = await this.db.select().from(messages).where(eq(messages.id, id)).limit(1);
    if (!existing) return undefined;
    const nextContent = `${existing.content}${appendText}`;
    await this.db.update(messages).set({ content: nextContent }).where(eq(messages.id, id));
    const [updated] = await this.db.select().from(messages).where(eq(messages.id, id)).limit(1);
    return updated ? toMessage(updated) : undefined;
  }
}
