import type { Agent, AgentResolveResult, AgentStatus } from '@crewden/shared';

const ACTIVE_STATUSES: Set<AgentStatus> = new Set(['starting', 'running', 'working', 'idle']);

export function isAgentActive(status: AgentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function resolveAgentReference(query: string, agents: Agent[]): AgentResolveResult {
  const value = query.trim();
  if (!value) return result(value, undefined, undefined, []);
  const normalized = normalize(value);

  const exactId = agents.find((agent) => agent.id === value);
  if (exactId) return result(value, exactId, 'exact_id', [exactId]);

  const exactName = agents.find((agent) => agent.name === value);
  if (exactName) return result(value, exactName, 'exact_name', [exactName]);

  const exactDisplay = agents.find((agent) => agent.displayName === value);
  if (exactDisplay) return result(value, exactDisplay, 'exact_display_name', [exactDisplay]);

  const ciName = agents.find((agent) => normalize(agent.name) === normalized);
  if (ciName) return result(value, ciName, 'case_insensitive_name', [ciName]);

  const ciDisplay = agents.find((agent) => agent.displayName && normalize(agent.displayName) === normalized);
  if (ciDisplay) return result(value, ciDisplay, 'case_insensitive_display_name', [ciDisplay]);

  const candidates = agents.filter((agent) => {
    const org = agent.organization;
    const fields = [
      agent.name,
      agent.displayName,
      agent.description,
      org?.department,
      ...(org?.roles ?? []),
      ...(org?.capabilities ?? []),
      ...(org?.responsibilities ?? []),
    ].filter(Boolean).map((field) => normalize(field!));
    return fields.some((field) => field.includes(normalized) || normalized.includes(field));
  });
  return result(value, candidates.length === 1 ? candidates[0] : undefined, candidates.length === 1 ? 'description_hint' : undefined, candidates);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function result(query: string, match: Agent | undefined, confidence: AgentResolveResult['confidence'], candidates: Agent[]): AgentResolveResult {
  return { query, match, confidence, candidates };
}
