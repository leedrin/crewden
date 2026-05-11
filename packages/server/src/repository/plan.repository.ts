import { eq, desc } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Plan, PlanStep, PlanRisk, ActorType } from '@crewden/shared';
import { taskPlans } from '../schema.js';

type Database = LibSQLDatabase<typeof import('../schema.js')>;

function toPlan(row: typeof taskPlans.$inferSelect): Plan {
  return {
    id: row.id,
    projectId: row.projectId === 'default' ? undefined : row.projectId,
    taskId: row.taskId,
    status: row.status as Plan['status'],
    approach: row.approach,
    steps: JSON.parse(row.steps) as PlanStep[],
    risks: row.risks ? (JSON.parse(row.risks) as PlanRisk[]) : undefined,
    filesToModify: row.filesToModify ? (JSON.parse(row.filesToModify) as string[]) : undefined,
    filesToCreate: row.filesToCreate ? (JSON.parse(row.filesToCreate) as string[]) : undefined,
    testsToAdd: row.testsToAdd ? (JSON.parse(row.testsToAdd) as string[]) : undefined,
    authorType: row.authorType as ActorType,
    authorId: row.authorId,
    reviewerType: (row.reviewerType as ActorType | null) ?? undefined,
    reviewerId: row.reviewerId ?? undefined,
    reviewerApproved: row.reviewerApproved ?? undefined,
    reviewerComment: row.reviewerComment ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqlitePlanRepository {
  constructor(private db: Database) {}

  async getByTaskId(taskId: string): Promise<Plan | undefined> {
    const [row] = await this.db
      .select()
      .from(taskPlans)
      .where(eq(taskPlans.taskId, taskId))
      .orderBy(desc(taskPlans.createdAt))
      .limit(1);
    return row ? toPlan(row) : undefined;
  }

  async getById(id: string): Promise<Plan | undefined> {
    const [row] = await this.db
      .select()
      .from(taskPlans)
      .where(eq(taskPlans.id, id))
      .limit(1);
    return row ? toPlan(row) : undefined;
  }

  async create(data: {
    projectId?: string;
    taskId: string;
    approach: string;
    steps: PlanStep[];
    risks?: PlanRisk[];
    filesToModify?: string[];
    filesToCreate?: string[];
    testsToAdd?: string[];
    authorType: ActorType;
    authorId: string;
  }): Promise<Plan> {
    const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const row = {
      id,
      projectId: data.projectId ?? 'default',
      taskId: data.taskId,
      status: 'draft' as const,
      approach: data.approach,
      steps: JSON.stringify(data.steps),
      risks: data.risks ? JSON.stringify(data.risks) : null,
      filesToModify: data.filesToModify ? JSON.stringify(data.filesToModify) : null,
      filesToCreate: data.filesToCreate ? JSON.stringify(data.filesToCreate) : null,
      testsToAdd: data.testsToAdd ? JSON.stringify(data.testsToAdd) : null,
      authorType: data.authorType,
      authorId: data.authorId,
      reviewerType: null,
      reviewerId: null,
      reviewerApproved: null,
      reviewerComment: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(taskPlans).values(row);
    return toPlan(row);
  }

  async updateStatus(id: string, status: Plan['status']): Promise<Plan | undefined> {
    const existing = await this.getById(id);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    await this.db
      .update(taskPlans)
      .set({ status, updatedAt: now })
      .where(eq(taskPlans.id, id));
    return { ...existing, status, updatedAt: now };
  }

  async review(id: string, data: {
    reviewerType: ActorType;
    reviewerId: string;
    approved: boolean;
    comment?: string;
  }): Promise<Plan | undefined> {
    const existing = await this.getById(id);
    if (!existing) return undefined;
    if (existing.status !== 'submitted') return undefined;
    const now = new Date().toISOString();
    const status = data.approved ? 'approved' as const : 'rejected' as const;
    await this.db
      .update(taskPlans)
      .set({
        status,
        reviewerType: data.reviewerType,
        reviewerId: data.reviewerId,
        reviewerApproved: data.approved,
        reviewerComment: data.comment ?? null,
        updatedAt: now,
      })
      .where(eq(taskPlans.id, id));
    return {
      ...existing,
      status,
      reviewerType: data.reviewerType,
      reviewerId: data.reviewerId,
      reviewerApproved: data.approved,
      reviewerComment: data.comment,
      updatedAt: now,
    };
  }
}
