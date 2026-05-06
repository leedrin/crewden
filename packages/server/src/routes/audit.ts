import type { FastifyInstance } from 'fastify';
import { getStore } from '../db.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { projectId?: string; taskId?: string; entityType?: string; entityId?: string } }>('/api/audit', async (req) => {
    return getStore().listAuditLogs({
      projectId: req.query.projectId,
      taskId: req.query.taskId,
      entityType: req.query.entityType,
      entityId: req.query.entityId,
    });
  });
}
