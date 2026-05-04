import { describe, it, expect, beforeEach } from 'vitest';
import { getStore, resetStore, resetVolatileState } from '../src/db.js';

const store = getStore();

beforeEach(async () => {
  await resetStore();
});

describe('channels', () => {
  it('creates default general channel', async () => {
    const channels = await store.listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('general');
  });

  it('creates a channel and lists it', async () => {
    await store.createChannel('random', 'random');
    const channels = await store.listChannels();
    expect(channels.map((channel) => channel.id)).toContain('random');
  });
});

describe('messages', () => {
  it('adds and lists messages sorted by createdAt', async () => {
    await store.createMessage({ id: 'msg-2', channelId: 'general', senderName: 'user', content: 'World' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.createMessage({ id: 'msg-1', channelId: 'general', senderName: 'user', content: 'Hello' });

    const messages = await store.listMessages('general');
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.content)).toEqual(['World', 'Hello']);
  });

  it('filters by channelId', async () => {
    await store.createChannel('other', 'other');
    await store.createMessage({ id: 'msg-1', channelId: 'general', senderName: 'user', content: 'A' });
    await store.createMessage({ id: 'msg-2', channelId: 'other', senderName: 'user', content: 'B' });
    expect(await store.listMessages('general')).toHaveLength(1);
    expect(await store.listMessages('other')).toHaveLength(1);
  });
});

describe('audit log', () => {
  it('appends and lists audit log entries by task id', async () => {
    const entry = await store.appendAuditLog({
      actorType: 'agent',
      actorId: 'agent-1',
      action: 'task.status_changed',
      entityType: 'task',
      entityId: 'task-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      detailJson: { from: 'todo', to: 'in_progress' },
    });

    expect(entry).toMatchObject({
      actorType: 'agent',
      actorId: 'agent-1',
      action: 'task.status_changed',
      entityType: 'task',
      entityId: 'task-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      detailJson: { from: 'todo', to: 'in_progress' },
    });
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeTruthy();
    expect(await store.listAuditLogs({ taskId: 'task-1' })).toEqual([entry]);
    expect(await store.listAuditLogs({ taskId: 'other' })).toEqual([]);
  });
});

describe('agents', () => {
  it('returns the created agent from getAgent', async () => {
    await store.createAgent({
      id: 'agent-1',
      name: 'my-agent',
      displayName: 'My Agent',
      runtime: 'claude',
      model: 'sonnet',
      systemPrompt: 'Be concise',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });

    const agent = await store.getAgent('agent-1');
    expect(agent).toMatchObject({
      id: 'agent-1',
      name: 'my-agent',
      displayName: 'My Agent',
      runtime: 'claude',
      model: 'sonnet',
      systemPrompt: 'Be concise',
      status: 'inactive',
    });
  });

  it('updates agent status', async () => {
    await store.createAgent({
      id: 'agent-1',
      name: 'my-agent',
      runtime: 'claude',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });
    await store.updateAgentStatus('agent-1', 'running');
    expect((await store.getAgent('agent-1'))?.status).toBe('running');
  });

  it('finds agents by name ignoring case', async () => {
    await store.createAgent({
      id: 'agent-1',
      name: 'Lydia',
      displayName: '产品经理',
      runtime: 'gemini',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });

    expect((await store.findAgentByNameOrId('lydia'))?.id).toBe('agent-1');
    expect((await store.findAgentByNameOrId('产品经理'))?.id).toBe('agent-1');
    expect((await store.resolveAgent('产品经理')).confidence).toBe('exact_display_name');
  });

  it('stores and resolves runtimeInstanceId mapping', async () => {
    await store.createAgent({
      id: 'agent-1',
      name: 'runtime-agent',
      runtime: 'codex',
      status: 'inactive',
      createdAt: new Date().toISOString(),
    });

    await store.setAgentRuntimeInstanceId('agent-1', 'paseo-agent-123');
    expect((await store.getAgent('agent-1'))?.runtimeInstanceId).toBe('paseo-agent-123');
    expect((await store.getAgentByRuntimeInstanceId('paseo-agent-123'))?.id).toBe('agent-1');

    await store.clearAgentRuntimeInstanceId('agent-1');
    expect((await store.getAgent('agent-1'))?.runtimeInstanceId).toBeUndefined();
    expect(await store.getAgentByRuntimeInstanceId('paseo-agent-123')).toBeUndefined();
  });
});

describe('machines', () => {
  it('returns the upserted machine from getMachine', async () => {
    const machine = {
      id: 'machine-1',
      hostname: 'my-host',
      os: 'darwin',
      daemonVersion: '0.1.0',
      runtimes: ['claude' as const],
      runtimeVersions: { claude: '1.0' },
      status: 'online' as const,
      connectedAt: new Date().toISOString(),
    };

    await store.upsertMachine(machine);

    expect(await store.getMachine('machine-1')).toEqual(machine);
  });

  it('updates an existing machine on repeated upsert', async () => {
    await store.upsertMachine({
      id: 'machine-1',
      hostname: 'old-host',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: [],
      runtimeVersions: {},
      status: 'online',
      connectedAt: new Date().toISOString(),
    });
    await store.upsertMachine({
      id: 'machine-1',
      hostname: 'new-host',
      os: 'darwin',
      daemonVersion: '0.2.0',
      runtimes: ['codex'],
      runtimeVersions: { codex: '2.0' },
      status: 'online',
      connectedAt: new Date().toISOString(),
    });

    const machines = await store.listMachines();
    expect(machines).toHaveLength(1);
    expect(machines[0].hostname).toBe('new-host');
    expect(machines[0].runtimes).toEqual(['codex']);
  });

  it('sets machine offline', async () => {
    await store.upsertMachine({
      id: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: [],
      runtimeVersions: {},
      status: 'online',
      connectedAt: new Date().toISOString(),
    });
    await store.setMachineOffline('machine-1');
    expect((await store.getMachine('machine-1'))?.status).toBe('offline');
  });
});

describe('volatile restart state', () => {
  it('marks machines offline without clearing agent run intent or observed status', async () => {
    await store.upsertMachine({
      id: 'machine-1',
      hostname: 'h',
      os: 'linux',
      daemonVersion: '0.1.0',
      runtimes: [],
      runtimeVersions: {},
      status: 'online',
      connectedAt: new Date().toISOString(),
    });
    await store.createAgent({
      id: 'agent-1',
      name: 'bot',
      runtime: 'claude',
      status: 'running',
      autoStart: true,
      machineId: 'machine-1',
      createdAt: new Date().toISOString(),
    });

    await resetVolatileState();

    expect((await store.getMachine('machine-1'))?.status).toBe('offline');
    expect((await store.getAgent('agent-1'))).toMatchObject({ status: 'running', autoStart: true });
  });
});
