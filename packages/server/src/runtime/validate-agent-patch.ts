import type { Agent, PatchAgentRequest } from '@crewden/shared';

const BUSY_STATUSES = new Set<Agent['status']>(['starting', 'running', 'working']);

export type AgentPatchError = {
  statusCode: 409;
  error: string;
};

export function validateAgentPatch(agent: Agent, patch: PatchAgentRequest): AgentPatchError | undefined {
  if (!patch.runtime) return undefined;
  if (patch.runtime === agent.runtime) return undefined;
  if (!BUSY_STATUSES.has(agent.status)) return undefined;
  return {
    statusCode: 409,
    error: `Cannot change runtime while agent is ${agent.status}. Stop the agent first.`,
  };
}
