import type { Agent, AgentMatchQuery, AgentMatchResult } from '@crewden/shared';

export function resolveAgents(agents: Agent[], query: AgentMatchQuery): AgentMatchResult[] {
  const requestedCapabilities = query.capabilities ?? [];
  const filtered = agents.filter((agent) => {
    if (query.excludeAgentId && agent.id === query.excludeAgentId) return false;
    if (query.mustBeIdle && agent.status !== 'idle') return false;
    if (query.role && (agent.role ?? 'unassigned') !== query.role) return false;
    if (requestedCapabilities.length > 0) {
      const capabilities = new Set(agent.capabilities ?? []);
      if (!requestedCapabilities.every((capability) => capabilities.has(capability))) return false;
    }
    return true;
  });

  const ranked = filtered
    .map((agent) => scoreAgent(agent, query))
    .sort((a, b) => b.score - a.score || a.agent.createdAt.localeCompare(b.agent.createdAt));

  if (!query.maxResults || query.maxResults <= 0) return ranked;
  return ranked.slice(0, query.maxResults);
}

function scoreAgent(agent: Agent, query: AgentMatchQuery): AgentMatchResult {
  let score = 0;
  const matchReason: string[] = [];
  if (query.role && (agent.role ?? 'unassigned') === query.role) {
    score += 60;
    matchReason.push(`role:${query.role}`);
  }
  const requestedCapabilities = query.capabilities ?? [];
  if (requestedCapabilities.length > 0) {
    const capabilities = new Set(agent.capabilities ?? []);
    const matched = requestedCapabilities.filter((capability) => capabilities.has(capability));
    if (matched.length > 0) {
      score += matched.length * 15;
      matchReason.push(`capabilities:${matched.join(',')}`);
    }
  }
  const loadScore = statusLoadScore(agent.status);
  score += loadScore;
  matchReason.push(`status:${agent.status}`);
  return { agent, score, matchReason };
}

function statusLoadScore(status: Agent['status']): number {
  if (status === 'idle') return 20;
  if (status === 'inactive') return 12;
  if (status === 'running') return 6;
  if (status === 'working') return 2;
  if (status === 'starting') return 1;
  return 0;
}
