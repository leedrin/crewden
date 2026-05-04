import { resolve } from 'node:path';
import type { Agent, AgentActivity, AgentStatus, WorkspaceEntry, WorkspaceError } from '@crewden/shared';
import { CrewdenContextInjector, InboxAdapter, PaseoDaemonClient, TimelineToEventBridge, mapRuntimeToProvider, type PaseoStreamEvent } from '@crewden/paseo-client';
import { getStore } from '../db.js';
import { eventBus } from '../events.js';
import { RuntimeInstanceMapper } from '../runtime/runtime-instance-mapper.js';
import type { AgentRuntimeBridge, DeliverMessageParams, ReadWorkspaceParams, StartAgentParams } from './types.js';

type PaseoModeOptions = {
  daemonUrl?: string;
  apiKey?: string;
  workspaceRoot?: string;
  mcpBridgeBin?: string;
  serverUrl?: string;
};

export class PaseoDaemonMode implements AgentRuntimeBridge {
  readonly mode = 'paseo-daemon' as const;

  private readonly options: PaseoModeOptions;
  private readonly mapper = new RuntimeInstanceMapper();
  private readonly inbox = new InboxAdapter();
  private readonly contextInjector = new CrewdenContextInjector();
  private readonly streamBridge = new TimelineToEventBridge();
  private readonly channelByRuntimeId = new Map<string, string>();
  private client: PaseoDaemonClient | undefined;

  constructor(options: PaseoModeOptions = {}) {
    this.options = options;
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  isConfigured(): boolean {
    return Boolean(this.options.daemonUrl?.trim());
  }

  async connect(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Paseo daemon is not configured');
    }
    if (!this.client) {
      this.client = new PaseoDaemonClient({
        daemonUrl: this.options.daemonUrl!,
        apiKey: this.options.apiKey,
      });
      this.client.onStreamEvent((runtimeInstanceId, event) => {
        void this.handleRuntimeStreamEvent(runtimeInstanceId, event);
      });
    }
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    await this.client.disconnect();
  }

  listConnectedMachineIds(): string[] {
    return [];
  }

  async startAgent(params: StartAgentParams): Promise<boolean> {
    const runtimeInstanceId = await this.mapper.resolveRuntimeInstanceId(params.agent.id);
    if (runtimeInstanceId) {
      if (params.wakeMessage) {
        return this.deliverMessage({
          agent: params.agent,
          seq: Date.now(),
          channelId: params.wakeMessage.channelId,
          message: params.wakeMessage,
          config: params.config,
          inboxSummary: params.inboxSummary,
        });
      }
      return true;
    }

    await this.connect();
    if (!this.client) return false;

    const provider = mapRuntimeToProvider(params.agent.runtime);
    const runtimeConfig = await getStore().getOrCreateAgentToken(params.agent.id);
    const mcpServers = this.buildMcpServers(params.agent.id, runtimeConfig.token);
    const systemPrompt = this.mergeSystemPrompt(params.config.systemPrompt);

    const created = await this.client.createAgent({
      provider,
      cwd: this.resolveAgentCwd(params.agent),
      model: params.config.model,
      systemPrompt,
      initialPrompt: params.wakeMessage
        ? this.contextInjector.buildDeliverPrompt({
            delivery: params.wakeMessage,
            inboxSummary: params.inboxSummary,
            agentId: params.agent.id,
            channelId: params.wakeMessage.channelId,
          })
        : undefined,
      mcpServers,
      labels: {
        crewdenAgentId: params.agent.id,
      },
    });

    await this.mapper.bind(params.agent.id, created.paseoAgentId);
    if (params.wakeMessage) {
      this.channelByRuntimeId.set(created.paseoAgentId, params.wakeMessage.channelId);
    }
    return true;
  }

  async stopAgent(agent: Agent): Promise<boolean> {
    const runtimeInstanceId = await this.mapper.resolveRuntimeInstanceId(agent.id);
    if (!runtimeInstanceId) return false;
    if (!this.client) return false;
    try {
      await this.client.stopAgent(runtimeInstanceId);
      await this.client.deleteAgent(runtimeInstanceId);
    } finally {
      await this.mapper.clear(agent.id);
      this.inbox.clear(runtimeInstanceId);
      this.channelByRuntimeId.delete(runtimeInstanceId);
    }
    return true;
  }

  async deliverMessage(params: DeliverMessageParams): Promise<boolean> {
    await this.connect();
    if (!this.client) return false;

    let runtimeInstanceId = await this.mapper.resolveRuntimeInstanceId(params.agent.id);
    if (!runtimeInstanceId) {
      const started = await this.startAgent({
        agent: params.agent,
        machineId: params.agent.machineId ?? 'paseo-runtime',
        launchId: `launch-${Date.now()}`,
        config: params.config ?? {
          runtime: params.agent.runtime,
          name: params.agent.name,
          displayName: params.agent.displayName,
          description: params.agent.description,
          systemPrompt: params.agent.systemPrompt,
          model: params.agent.model,
          envVars: params.agent.envVars,
        },
        wakeMessage: params.message,
        inboxSummary: params.inboxSummary,
      });
      if (!started) return false;
      runtimeInstanceId = await this.mapper.resolveRuntimeInstanceId(params.agent.id);
      return Boolean(runtimeInstanceId);
    }

    this.channelByRuntimeId.set(runtimeInstanceId, params.channelId);
    const prompt = this.contextInjector.buildDeliverPrompt({
      delivery: params.message,
      inboxSummary: params.inboxSummary,
      agentId: params.agent.id,
      channelId: params.channelId,
    });

    await this.inbox.enqueue(
      runtimeInstanceId,
      { ...params.message, content: prompt },
      async (id, text) => {
        await this.client!.sendMessage(id, text);
        await this.drainQueue(id);
      },
    );
    return true;
  }

  async readWorkspace(_params: ReadWorkspaceParams): Promise<WorkspaceEntry | WorkspaceError> {
    return {
      type: 'error',
      status: 501,
      error: 'Workspace read is not implemented for Paseo mode yet',
    };
  }

  private async drainQueue(runtimeInstanceId: string): Promise<void> {
    await this.inbox.onAgentIdle(runtimeInstanceId, async (id, text) => {
      await this.client!.sendMessage(id, text);
      await this.drainQueue(id);
    });
  }

  private resolveAgentCwd(agent: Agent): string {
    const base = this.options.workspaceRoot?.trim();
    if (!base) return process.cwd();
    return resolve(base, agent.name);
  }

  private mergeSystemPrompt(base?: string): string {
    const appendix = this.contextInjector.buildSystemPromptAppendix();
    if (!base) return appendix;
    return `${base.trim()}\n\n${appendix}`;
  }

  private buildMcpServers(agentId: string, agentToken: string): Record<string, { type: 'stdio'; command: string; args?: string[] }> | undefined {
    if (!this.options.mcpBridgeBin) return undefined;
    if (!this.options.serverUrl) return undefined;
    return this.contextInjector.buildMcpConfig({
      agentId,
      serverUrl: this.options.serverUrl,
      agentToken,
      mcpBridgeBin: this.options.mcpBridgeBin,
    }) as Record<string, { type: 'stdio'; command: string; args?: string[] }>;
  }

  private async handleRuntimeStreamEvent(runtimeInstanceId: string, event: PaseoStreamEvent): Promise<void> {
    const crewdenAgentId = await this.mapper.resolveCrewdenAgentId(runtimeInstanceId);
    if (!crewdenAgentId) return;
    const channelId = this.channelByRuntimeId.get(runtimeInstanceId) ?? 'general';
    const mapped = this.streamBridge.mapStreamEvent(event, crewdenAgentId, channelId);
    if (!mapped) return;

    const store = getStore();
    if (mapped.type === 'agent:status') {
      const status = mapped.status as AgentStatus;
      const updated = await store.updateAgentStatus(crewdenAgentId, status);
      if (updated) eventBus.emit({ type: 'agent:update', agent: updated });
      return;
    }

    if (mapped.type === 'agent:activity') {
      const activity = await store.createAgentActivity({
        id: crypto.randomUUID(),
        agentId: crewdenAgentId,
        type: mapped.activityType as AgentActivity['type'],
        detail: mapped.detail,
      });
      eventBus.emit({ type: 'agent:activity', agentId: crewdenAgentId, activity });
      return;
    }

    if (mapped.type === 'agent:message') {
      const channel = await store.getChannel(mapped.channelId);
      if (!channel) return;
      const agent = await store.getAgent(crewdenAgentId);
      const message = await store.createMessage({
        id: crypto.randomUUID(),
        channelId: mapped.channelId,
        agentId: crewdenAgentId,
        senderName: agent?.displayName ?? agent?.name ?? crewdenAgentId,
        content: mapped.content,
      });
      eventBus.emit({ type: 'message:new', message });
    }
  }
}
