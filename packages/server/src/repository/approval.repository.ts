import { eq, and, desc } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Approval, ApprovalType, ApprovalStatus, ActorType } from '@crewden/shared';
import { approvals as approvalsTable } from '../schema.js';

type Database = LibSQLDatabase<typeof import('../schema.js')>;

function toApproval(row: typeof approvalsTable.$inferSelect): Approval {
  return {
    id: row.id,
    projectId: row.projectId === 'default' ? undefined : row.projectId,
    type: row.type as ApprovalType,
    targetId: row.targetId,
    status: row.status as ApprovalStatus,
    requestedByType: row.requestedByType as ActorType,
    requestedById: row.requestedById,
    approvedByType: (row.approvedByType as ActorType | null) ?? undefined,
    approvedById: row.approvedById ?? undefined,
    reason: row.reason,
    context: row.context ?? undefined,
    requestedAt: row.requestedAt,
    respondedAt: row.respondedAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    comment: row.comment ?? undefined,
  };
}

export class SqliteApprovalRepository {
  constructor(private db: Database) {}

  async getById(id: string): Promise<Approval | undefined> {
    const [row] = await this.db
      .select()
      .from(approvalsTable)
      .where(eq(approvalsTable.id, id))
      .limit(1);
    return row ? toApproval(row) : undefined;
  }

  async list(filter: { type?: ApprovalType; targetId?: string; status?: ApprovalStatus } = {}): Promise<Approval[]> {
    const conditions = [];
    if (filter.type) conditions.push(eq(approvalsTable.type, filter.type));
    if (filter.targetId) conditions.push(eq(approvalsTable.targetId, filter.targetId));
    if (filter.status) conditions.push(eq(approvalsTable.status, filter.status));

    const rows = await this.db
      .select()
      .from(approvalsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(approvalsTable.requestedAt));
    return rows.map(toApproval);
  }

  async getPendingForTarget(targetId: string, type: ApprovalType): Promise<Approval | undefined> {
    const [row] = await this.db
      .select()
      .from(approvalsTable)
      .where(
        and(
          eq(approvalsTable.targetId, targetId),
          eq(approvalsTable.type, type),
          eq(approvalsTable.status, 'pending'),
        ),
      )
      .limit(1);
    return row ? toApproval(row) : undefined;
  }

  async create(data: {
    projectId?: string;
    type: ApprovalType;
    targetId: string;
    requestedByType: ActorType;
    requestedById: string;
    reason: string;
    context?: string;
    expiresAt?: string;
  }): Promise<Approval> {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const row = {
      id,
      projectId: data.projectId ?? 'default',
      type: data.type,
      targetId: data.targetId,
      status: 'pending' as const,
      requestedByType: data.requestedByType,
      requestedById: data.requestedById,
      approvedByType: null,
      approvedById: null,
      reason: data.reason,
      context: data.context ?? null,
      requestedAt: now,
      respondedAt: null,
      expiresAt: data.expiresAt ?? null,
      comment: null,
    };
    await this.db.insert(approvalsTable).values(row);
    return toApproval(row);
  }

  async respond(id: string, data: {
    approvedByType: ActorType;
    approvedById: string;
    approved: boolean;
    comment?: string;
  }): Promise<Approval | undefined> {
    const existing = await this.getById(id);
    if (!existing) return undefined;
    if (existing.status !== 'pending') return undefined;
    const now = new Date().toISOString();
    const status = data.approved ? 'approved' as const : 'rejected' as const;
    await this.db
      .update(approvalsTable)
      .set({
        status,
        approvedByType: data.approvedByType,
        approvedById: data.approvedById,
        respondedAt: now,
        comment: data.comment ?? null,
      })
      .where(eq(approvalsTable.id, id));
    return {
      ...existing,
      status,
      approvedByType: data.approvedByType,
      approvedById: data.approvedById,
      respondedAt: now,
      comment: data.comment,
    };
  }

  async expireOverdue(): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.db
      .update(approvalsTable)
      .set({ status: 'expired', respondedAt: now, comment: 'Auto-expired' })
      .where(
        and(
          eq(approvalsTable.status, 'pending'),
          // SQLite string comparison works for ISO dates
        ),
      );
    return result.rowsAffected ?? 0;
  }
}
