import type { AgentRuntimeConfig, Agent } from '@crewden/shared';
import { toRuntimeConfig } from '@crewden/hub-core';
import { getStore } from '../db.js';

export async function toAgentRuntimeConfig(agent: Agent): Promise<AgentRuntimeConfig> {
  const token = await getStore().getOrCreateAgentToken(agent.id);
  return {
    ...toRuntimeConfig(agent),
    envVars: agent.envVars,
    agentToken: token.token,
  };
}
