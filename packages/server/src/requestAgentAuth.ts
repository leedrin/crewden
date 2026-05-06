import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Agent } from '@crewden/shared';
import { getStore } from './db.js';

export async function resolveActingAgent(req: FastifyRequest, reply: FastifyReply): Promise<Agent | undefined> {
  const headerAgentId = req.headers['x-agent-id'];
  if (typeof headerAgentId !== 'string' || !headerAgentId.trim()) return undefined;
  const token = bearerToken(req);
  if (!token) {
    reply.status(401).send({ error: 'Missing bearer token' });
    return undefined;
  }
  const agent = await getStore().getAgent(headerAgentId);
  if (!agent) {
    reply.status(404).send({ error: 'Agent not found' });
    return undefined;
  }
  const valid = await getStore().verifyAgentToken(agent.id, token);
  if (!valid) {
    reply.status(401).send({ error: 'Invalid agent token' });
    return undefined;
  }
  return agent;
}

function bearerToken(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  if (!auth) return undefined;
  const [type, token] = auth.split(' ');
  if (!type || type.toLowerCase() !== 'bearer' || !token) return undefined;
  return token;
}
