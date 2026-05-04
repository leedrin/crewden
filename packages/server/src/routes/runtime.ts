import type { FastifyInstance } from 'fastify';
import { paseoRuntimeService } from '../runtime/paseo-runtime-service.js';

export async function runtimeRoutes(app: FastifyInstance) {
  app.get('/api/runtime/status', async () => {
    const status = paseoRuntimeService.getStatus();
    return {
      mode: status.effectiveMode,
      configuredMode: status.configuredMode,
      connected: status.connected,
      fallbackReason: status.fallbackReason,
    };
  });
}
