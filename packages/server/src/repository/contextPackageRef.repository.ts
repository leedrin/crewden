import type { Client } from '@libsql/client';
import type { ContextPackageRefRepository } from './types.js';

export class SqliteContextPackageRefRepository implements ContextPackageRefRepository {
  constructor(private client: Client) {}

  async addRef(taskId: string, refType: string, refId: string, refUpdatedAt: string): Promise<void> {
    await this.client.execute({
      sql: 'INSERT OR REPLACE INTO context_package_refs (task_id, ref_type, ref_id, ref_updated_at) VALUES (?, ?, ?, ?)',
      args: [taskId, refType, refId, refUpdatedAt],
    });
  }

  async removeRefsForTask(taskId: string): Promise<void> {
    await this.client.execute({
      sql: 'DELETE FROM context_package_refs WHERE task_id = ?',
      args: [taskId],
    });
  }

  async findTaskIdsByRef(refType: string, refId: string): Promise<string[]> {
    const rs = await this.client.execute({
      sql: 'SELECT task_id FROM context_package_refs WHERE ref_type = ? AND ref_id = ?',
      args: [refType, refId],
    });
    return rs.rows.map((row) => String(row.task_id));
  }
}
