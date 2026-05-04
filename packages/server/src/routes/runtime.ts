import type { FastifyInstance } from 'fastify';
import { access } from 'node:fs/promises';
import { z } from 'zod';
import { paseoRuntimeService } from '../runtime/paseo-runtime-service.js';

export async function runtimeRoutes(app: FastifyInstance) {
  app.get('/api/runtime/status', async () => {
    const status = paseoRuntimeService.getStatus();
    const health = await paseoRuntimeService.getHealthReport();
    const diagnostics = [...(status.diagnostics ?? [])];
    const alerts: string[] = [];
    let mcpBridgeReady = status.mcpBridgeReady ?? false;
    if (status.mcpBridgeBin) {
      try {
        await access(status.mcpBridgeBin);
        mcpBridgeReady = true;
      } catch {
        mcpBridgeReady = false;
        diagnostics.push(`MCP bridge binary not found: ${status.mcpBridgeBin}`);
      }
    }
    const effectiveConnected = status.connected || health.agents.some((agent) => Boolean(agent.runtimeLifecycle && agent.runtimeLifecycle !== 'closed'));
    if (!effectiveConnected && health.disconnectedWithActiveAgents) {
      alerts.push('daemon_disconnected_while_agents_active');
    }
    for (const agent of health.agents) {
      if (agent.issues.includes('permission_pending')) {
        alerts.push(`permission_pending:${agent.name}`);
      }
      if (agent.issues.includes('stream_stalled')) {
        alerts.push(`stream_stalled:${agent.name}`);
      }
      if (agent.issues.includes('runtime_fetch_failed') || agent.issues.includes('runtime_instance_not_found')) {
        alerts.push(`runtime_unreachable:${agent.name}`);
      }
      if (agent.issues.includes('state_mismatch_running_vs_idle')) {
        alerts.push(`state_mismatch:${agent.name}`);
      }
    }
    return {
      mode: status.effectiveMode,
      configuredMode: status.configuredMode,
      connected: effectiveConnected,
      fallbackReason: status.fallbackReason,
      daemonUrl: status.daemonUrl,
      mcpBridgeBin: status.mcpBridgeBin,
      mcpBridgeReady,
      diagnostics,
      alerts,
      agentHealth: health.agents,
    };
  });

  app.post<{ Params: { agentId: string; permissionId: string } }>(
    '/api/runtime/agents/:agentId/permissions/:permissionId/respond',
    async (req, reply) => {
      const schema = z.union([
        z.object({
          behavior: z.literal('allow'),
          selectedActionId: z.string().optional(),
          updatedInput: z.record(z.unknown()).optional(),
          updatedPermissions: z.array(z.record(z.unknown())).optional(),
        }),
        z.object({
          behavior: z.literal('deny'),
          selectedActionId: z.string().optional(),
          message: z.string().optional(),
          interrupt: z.boolean().optional(),
        }),
      ]);
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid permission response payload' });
      }

      const result = await paseoRuntimeService.respondToPermission({
        agentId: req.params.agentId,
        permissionRequestId: req.params.permissionId,
        response: parsed.data,
      });
      if (!result.ok) {
        return reply.status(422).send({ error: result.error });
      }
      return { ok: true };
    },
  );
}
