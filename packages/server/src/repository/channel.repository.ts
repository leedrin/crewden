import { asc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Channel } from '@crewden/shared';
import { channels, decisions, documents, goalAlignments, goals, messages, reminders, tasks } from '../schema.js';
import type { ChannelRepository } from './types.js';

type Database = LibSQLDatabase<typeof import('../schema.js')>;

const DEFAULT_PROJECT_ID = 'default';

function toChannel(row: typeof channels.$inferSelect): Channel {
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    name: row.name,
    createdAt: row.createdAt,
  };
}

export class SqliteChannelRepository implements ChannelRepository {
  constructor(private db: Database) {}

  async list(filter: { projectId?: string } = {}): Promise<Channel[]> {
    const rows = await this.db.select().from(channels).orderBy(asc(channels.createdAt));
    return rows
      .map(toChannel)
      .filter((channel) => !filter.projectId || channel.projectId === filter.projectId);
  }

  async getById(id: string, filter: { projectId?: string } = {}): Promise<Channel | undefined> {
    const [channel] = await this.db.select().from(channels).where(eq(channels.id, id)).limit(1);
    const parsed = channel ? toChannel(channel) : undefined;
    if (!parsed) return undefined;
    if (filter.projectId && parsed.projectId !== filter.projectId) return undefined;
    return parsed;
  }

  async create(id: string, name: string, projectId: string): Promise<Channel> {
    const channel: Channel = { id, projectId, name, createdAt: new Date().toISOString() };
    await this.db.insert(channels).values(channel);
    return channel;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await this.db.delete(messages).where(eq(messages.channelId, id));
    await this.db.delete(tasks).where(eq(tasks.channelId, id));
    await this.db.delete(goals).where(eq(goals.channelId, id));
    await this.db.delete(goalAlignments).where(eq(goalAlignments.channelId, id));
    await this.db.delete(reminders).where(eq(reminders.channelId, id));
    await this.db.delete(decisions).where(eq(decisions.channelId, id));
    await this.db.delete(documents).where(eq(documents.sourceChannelId, id));
    await this.db.delete(channels).where(eq(channels.id, id));
    return true;
  }
}
