import { describe, expect, it } from 'vitest';
import type { Agent } from '@crewden/shared';
import { resolveAgents } from '../src/agentResolver.js';

const agents: Agent[] = [
  {
    id: 'a1',
    name: 'dev-1',
    runtime: 'codex',
    role: 'developer',
    capabilities: ['coding', 'review'],
    status: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    permissions: {
      readChannels: [],
      writeChannels: [],
      createDocs: false,
      createTasks: true,
      claimTasks: true,
      createBranches: false,
      createPrs: false,
      mergeToMain: false,
      deployToProd: false,
      accessSensitiveData: false,
      callExternalApis: [],
      maxContextTokens: 100000,
      requiresApprovalFor: [],
    },
  },
  {
    id: 'a2',
    name: 'dev-2',
    runtime: 'codex',
    role: 'developer',
    capabilities: ['coding'],
    status: 'working',
    createdAt: '2026-01-01T00:00:01.000Z',
    permissions: {
      readChannels: [],
      writeChannels: [],
      createDocs: false,
      createTasks: true,
      claimTasks: true,
      createBranches: false,
      createPrs: false,
      mergeToMain: false,
      deployToProd: false,
      accessSensitiveData: false,
      callExternalApis: [],
      maxContextTokens: 100000,
      requiresApprovalFor: [],
    },
  },
  {
    id: 'a3',
    name: 'qa-1',
    runtime: 'claude',
    role: 'qa',
    capabilities: ['testing'],
    status: 'idle',
    createdAt: '2026-01-01T00:00:02.000Z',
    permissions: {
      readChannels: [],
      writeChannels: [],
      createDocs: false,
      createTasks: true,
      claimTasks: true,
      createBranches: false,
      createPrs: false,
      mergeToMain: false,
      deployToProd: false,
      accessSensitiveData: false,
      callExternalApis: [],
      maxContextTokens: 100000,
      requiresApprovalFor: [],
    },
  },
];

describe('resolveAgents', () => {
  it('ranks exact role and low-load agents first', () => {
    const result = resolveAgents(agents, { role: 'developer' });
    expect(result[0].agent.id).toBe('a1');
    expect(result[1].agent.id).toBe('a2');
  });

  it('applies capability matching', () => {
    const result = resolveAgents(agents, { role: 'developer', capabilities: ['coding', 'review'] });
    expect(result).toHaveLength(1);
    expect(result[0].agent.id).toBe('a1');
  });

  it('supports exclude and mustBeIdle filters', () => {
    const result = resolveAgents(agents, { role: 'developer', excludeAgentId: 'a1', mustBeIdle: true });
    expect(result).toHaveLength(0);
  });
});
