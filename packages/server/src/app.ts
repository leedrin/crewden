import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { agentRoutes } from './routes/agents.js';
import { machineRoutes } from './routes/machines.js';
import { internalAgentRoutes } from './routes/internalAgent.js';
import { taskRoutes } from './routes/tasks.js';
import { goalRoutes } from './routes/goals.js';
import { goalAlignmentRoutes } from './routes/goalAlignments.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { runtimeRoutes } from './routes/runtime.js';
import { daemonSocketHandler } from './ws/daemonSocket.js';
import { browserSocketHandler } from './ws/browserSocket.js';
import { initDb, resetVolatileState } from './db.js';
import { createVersionInfo } from '@crewden/shared';
import { startReminderScheduler } from './reminders.js';
import { browserAuthConfigured, requireBrowserAuth } from './browserAuth.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  await initDb();
  await resetVolatileState();

  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    if (!request.url.startsWith('/api/')) return;
    await requireBrowserAuth(request, reply);
    if (reply.sent) return reply;
  });

  app.get('/api/auth/whoami', async () => {
    return { authenticated: true, mode: browserAuthConfigured() ? 'token' : 'anonymous' };
  });

  app.get('/api/version', async () => {
    return createVersionInfo('server', {
      version: process.env.CREWDEN_VERSION,
      commit: process.env.CREWDEN_COMMIT_SHA ?? process.env.GITHUB_SHA,
      build: process.env.CREWDEN_BUILD_ID ?? process.env.GITHUB_RUN_ID,
    });
  });

  await app.register(channelRoutes);
  await app.register(messageRoutes);
  await app.register(agentRoutes);
  await app.register(machineRoutes);
  await app.register(taskRoutes);
  await app.register(goalRoutes);
  await app.register(goalAlignmentRoutes);
  await app.register(knowledgeRoutes);
  await app.register(runtimeRoutes);
  await app.register(internalAgentRoutes);
  await app.register(daemonSocketHandler);
  await app.register(browserSocketHandler);

  const stopReminders = startReminderScheduler();
  app.addHook('onClose', async () => stopReminders());

  return app;
}
