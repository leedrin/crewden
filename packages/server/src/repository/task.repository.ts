import { asc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Client } from '@libsql/client';
import type { Task, TaskStatus, ActorType } from '@crewden/shared';
import { tasks } from '../schema.js';
import type { TaskRepository, NewTask, TaskPatch } from './types.js';

type Database = LibSQLDatabase<typeof import('../schema.js')>;

const DEFAULT_PROJECT_ID = 'default';

function normalizeTaskStatus(status: string): TaskStatus {
  if (status === 'todo') return 'backlog';
  if (status === 'blocked') return 'in_progress';
  return status as TaskStatus;
}

function parseStringArray(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
}

function toTask(row: typeof tasks.$inferSelect): Task {
  const context = row.context ? JSON.parse(row.context) as Task['context'] : undefined;
  const ownerId = row.ownerId ?? row.assigneeId ?? undefined;
  const reviewerId = row.reviewerId ?? context?.reviewerAgentId ?? undefined;
  return {
    id: row.id,
    projectId: row.projectId ?? DEFAULT_PROJECT_ID,
    channelId: row.channelId,
    messageId: row.messageId ?? undefined,
    title: row.title,
    status: normalizeTaskStatus(row.status),
    type: row.type as Task['type'],
    creatorName: row.creatorName,
    creator: {
      actorType: row.creatorType as ActorType,
      actorId: row.creatorId ?? row.creatorName,
    },
    assigneeId: row.assigneeId ?? undefined,
    owner: ownerId ? { actorType: (row.ownerType as ActorType | null) ?? 'agent', actorId: ownerId } : undefined,
    reviewer: reviewerId ? { actorType: (row.reviewerType as ActorType | null) ?? 'agent', actorId: reviewerId } : undefined,
    acceptanceCriteria: parseStringArray(row.acceptanceCriteria),
    definitionOfDone: parseStringArray(row.definitionOfDone),
    constraints: parseStringArray(row.constraints),
    dependsOn: parseStringArray(row.dependsOn),
    isBlocked: Boolean(row.isBlocked),
    blockedReason: row.blockedReason ?? context?.blockedReason,
    sourceChannelId: row.sourceChannelId ?? undefined,
    sourceThreadId: row.sourceThreadId ?? undefined,
    context,
    version: row.version ?? 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteTaskRepository implements TaskRepository {
  constructor(private db: Database, private rawClient: Client | null) {}

  async list(filter: { projectId?: string; channelId?: string; status?: TaskStatus; assigneeId?: string } = {}): Promise<Task[]> {
    const rows = await this.db.select().from(tasks).orderBy(asc(tasks.createdAt));
    return rows
      .map(toTask)
      .filter((task) =>
        (!filter.projectId || task.projectId === filter.projectId) &&
        (!filter.channelId || task.channelId === filter.channelId) &&
        (!filter.status || task.status === filter.status) &&
        (!filter.assigneeId || task.assigneeId === filter.assigneeId)
      );
  }

  async getById(id: string): Promise<Task | undefined> {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return task ? toTask(task) : undefined;
  }

  async create(task: NewTask): Promise<Task> {
    const now = new Date().toISOString();
    const owner = task.owner ?? (task.assigneeId ? { actorType: 'agent' as const, actorId: task.assigneeId } : undefined);
    const created: Task = {
      ...task,
      projectId: task.projectId ?? DEFAULT_PROJECT_ID,
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
    await this.db.insert(tasks).values({
      ...created,
      projectId: created.projectId,
      messageId: created.messageId ?? null,
      assigneeId: created.assigneeId ?? null,
      creatorType: created.creator.actorType,
      creatorId: created.creator.actorId,
      ownerType: created.owner?.actorType ?? null,
      ownerId: created.owner?.actorId ?? null,
      reviewerType: created.reviewer?.actorType ?? null,
      reviewerId: created.reviewer?.actorId ?? null,
      acceptanceCriteria: created.acceptanceCriteria ? JSON.stringify(created.acceptanceCriteria) : null,
      definitionOfDone: created.definitionOfDone ? JSON.stringify(created.definitionOfDone) : null,
      constraints: created.constraints ? JSON.stringify(created.constraints) : null,
      dependsOn: created.dependsOn ? JSON.stringify(created.dependsOn) : null,
      blockedReason: created.blockedReason ?? null,
      sourceChannelId: created.sourceChannelId ?? null,
      sourceThreadId: created.sourceThreadId ?? null,
      context: created.context ? JSON.stringify(created.context) : null,
    });
    return created;
  }

  async update(id: string, patch: TaskPatch): Promise<Task | undefined> {
    const existing = await this.getById(id);
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
    await this.db
      .update(tasks)
      .set({
        status: updated.status,
        assigneeId: updated.assigneeId ?? null,
        ownerType: updated.owner?.actorType ?? null,
        ownerId: updated.owner?.actorId ?? null,
        reviewerType: updated.reviewer?.actorType ?? null,
        reviewerId: updated.reviewer?.actorId ?? null,
        acceptanceCriteria: updated.acceptanceCriteria ? JSON.stringify(updated.acceptanceCriteria) : null,
        definitionOfDone: updated.definitionOfDone ? JSON.stringify(updated.definitionOfDone) : null,
        constraints: updated.constraints ? JSON.stringify(updated.constraints) : null,
        dependsOn: updated.dependsOn ? JSON.stringify(updated.dependsOn) : null,
        isBlocked: updated.isBlocked,
        blockedReason: updated.blockedReason ?? null,
        context: updated.context ? JSON.stringify(updated.context) : null,
        version: updated.version,
        updatedAt: updated.updatedAt,
      })
      .where(eq(tasks.id, id));
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await this.db.delete(tasks).where(eq(tasks.id, id));
    return true;
  }
}
