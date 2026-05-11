import { describe, expect, it } from 'vitest';
import type { Agent, Machine } from '@crewden/shared';
import { resetAgentStatusForRestart, resolveStartMachineId, toRuntimeConfig } from '../src/agent.js';
import { resolveAgentReference, isAgentActive } from '../src/agentResolve.js';

const agent: Agent = {
  id: 'agent-1',
  name: 'bot',
  displayName: 'Bot',
  description: 'Helpful bot',
  runtime: 'claude',
  model: 'sonnet',
  systemPrompt: 'Be concise',
  machineId: 'machine-1',
  status: 'inactive',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const machines: Machine[] = [
  {
    id: 'machine-1',
    hostname: 'host-1',
    os: 'linux',
    daemonVersion: '0.1.0',
    runtimes: ['claude'],
    runtimeVersions: { claude: '1.0' },
    status: 'online',
    connectedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'machine-2',
    hostname: 'host-2',
    os: 'darwin',
    daemonVersion: '0.1.0',
    runtimes: ['codex', 'gemini'],
    runtimeVersions: { codex: '1.0', gemini: '1.0' },
    status: 'online',
    connectedAt: '2026-01-01T00:00:01.000Z',
  },
];

describe('toRuntimeConfig', () => {
  it('maps persisted agent fields to daemon runtime config', () => {
    expect(toRuntimeConfig(agent)).toEqual({
      runtime: 'claude',
      model: 'sonnet',
      name: 'bot',
      displayName: 'Bot',
      description: 'Helpful bot',
      systemPrompt: 'Be concise',
    });
  });
});

describe('resolveStartMachineId', () => {
  it('prefers the agent bound machine when it is connected', () => {
    expect(resolveStartMachineId({ agent, machines, connectedMachineIds: new Set(['machine-1', 'machine-2']) })).toBe('machine-1');
  });

  it('falls back to the first connected compatible machine', () => {
    expect(resolveStartMachineId({ agent, machines, connectedMachineIds: new Set(['machine-2']) })).toBeUndefined();
    expect(
      resolveStartMachineId({
        agent: { ...agent, machineId: 'missing', runtime: 'codex' },
        machines,
        connectedMachineIds: new Set(['machine-2']),
      })
    ).toBe('machine-2');
  });

  it('returns undefined when no compatible connected machine exists', () => {
    expect(resolveStartMachineId({ agent, machines, connectedMachineIds: new Set() })).toBeUndefined();
  });
});

describe('resetAgentStatusForRestart', () => {
  it('resets volatile statuses to inactive', () => {
    expect(resetAgentStatusForRestart('starting')).toBe('inactive');
    expect(resetAgentStatusForRestart('running')).toBe('inactive');
    expect(resetAgentStatusForRestart('working')).toBe('inactive');
    expect(resetAgentStatusForRestart('idle')).toBe('inactive');
  });

  it('keeps stable statuses unchanged', () => {
    expect(resetAgentStatusForRestart('inactive')).toBe('inactive');
    expect(resetAgentStatusForRestart('error')).toBe('error');
  });
});

describe('resolveAgentReference', () => {
  const directory: Agent[] = [
    agent,
    { ...agent, id: 'agent-111', name: 'pm-111', displayName: '产品经理', description: 'Product manager for task triage' },
    { ...agent, id: 'agent-222', name: 'engineer', displayName: '工程师', description: 'Implementation specialist' },
  ];

  it('resolves by display name before fallback candidates', () => {
    const result = resolveAgentReference('产品经理', directory);
    expect(result.match?.id).toBe('agent-111');
    expect(result.confidence).toBe('exact_display_name');
  });

  it('returns description hint candidates for role-like queries', () => {
    const result = resolveAgentReference('task triage', directory);
    expect(result.match?.id).toBe('agent-111');
    expect(result.confidence).toBe('description_hint');
  });

  it('resolves by organization role and capability fields', () => {
    const result = resolveAgentReference('quality gate', [
      { ...agent, id: 'agent-333', name: 'qa', organization: { department: 'delivery', roles: ['QA'], capabilities: ['quality gate'] } },
    ]);
    expect(result.match?.id).toBe('agent-333');
    expect(result.confidence).toBe('description_hint');
  });
});

describe('isAgentActive', () => {
  it.each(['starting', 'running', 'working', 'idle'] as const)('returns true for active status %s', (status) => {
    expect(isAgentActive(status)).toBe(true);
  });

  it.each(['inactive', 'error'] as const)('returns false for inactive status %s', (status) => {
    expect(isAgentActive(status)).toBe(false);
  });
});
