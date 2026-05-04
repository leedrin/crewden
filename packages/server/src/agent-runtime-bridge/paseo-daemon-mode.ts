import { resolve } from 'node:path';
import type { Agent, AgentActivity, AgentStatus, WorkspaceEntry, WorkspaceError } from '@crewden/shared';
import { CrewdenContextInjector, InboxAdapter, PaseoDaemonClient, TimelineToEventBridge, mapRuntimeToProvider, type PaseoAgentSnapshot, type PaseoPermissionResponse, type PaseoStreamEvent } from '@crewden/paseo-client';
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

export type RuntimeAgentHealth = {
  agentId: string;
  runtimeInstanceId?: string;
  runtimeLifecycle?: string;
  pendingPermissions: NonNullable<PaseoAgentSnapshot["pendingPermissions"]>;
  issues: string[];
};

export class PaseoDaemonMode implements AgentRuntimeBridge {
  readonly mode = 'paseo-daemon' as const;

  private readonly options: PaseoModeOptions;
  private readonly mapper = new RuntimeInstanceMapper();
  private readonly inbox = new InboxAdapter();
  private readonly contextInjector = new CrewdenContextInjector();
  private readonly streamBridge = new TimelineToEventBridge();
  private readonly channelByRuntimeId = new Map<string, string>();
  private readonly sessionByAgentId = new Map<string, string>();
  private readonly streamingMessageByRuntimeId = new Map<string, { messageId: string; channelId: string }>();
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
      this.client.onAgentUpdate((runtimeInstanceId, snapshot) => {
        void this.handleRuntimeAgentUpdate(runtimeInstanceId, snapshot);
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
    await this.connect();
    if (!this.client) return false;

    let runtimeInstanceId = await this.mapper.resolveRuntimeInstanceId(params.agent.id);
    if (runtimeInstanceId) {
      const snapshot = await this.fetchLiveRuntimeSnapshot(runtimeInstanceId);
      if (!snapshot || snapshot.lifecycle === 'closed') {
        await this.mapper.clear(params.agent.id);
        this.inbox.clear(runtimeInstanceId);
        this.channelByRuntimeId.delete(runtimeInstanceId);
        this.streamingMessageByRuntimeId.delete(runtimeInstanceId);
        runtimeInstanceId = undefined;
      } else {
        await this.syncAgentStatus(params.agent.id, snapshot);
      }
    }

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
    await this.syncAgentStatus(params.agent.id, created.snapshot);
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
      this.sessionByAgentId.delete(agent.id);
      this.streamBridge.clear(agent.id);
      this.streamingMessageByRuntimeId.delete(runtimeInstanceId);
    }
    return true;
  }

  async deliverMessage(params: DeliverMessageParams): Promise<boolean> {
    await this.connect();
    if (!this.client) return false;

    let runtimeInstanceId = await this.mapper.resolveRuntimeInstanceId(params.agent.id);
    if (runtimeInstanceId) {
      const snapshot = await this.fetchLiveRuntimeSnapshot(runtimeInstanceId);
      if (!snapshot) {
        await this.mapper.clear(params.agent.id);
        this.inbox.clear(runtimeInstanceId);
        this.channelByRuntimeId.delete(runtimeInstanceId);
        this.streamingMessageByRuntimeId.delete(runtimeInstanceId);
        runtimeInstanceId = undefined;
      } else {
        await this.syncAgentStatus(params.agent.id, snapshot);
      }
    }
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

  async inspectRuntimeAgent(agentId: string): Promise<RuntimeAgentHealth> {
    const issues: string[] = [];
    const runtimeInstanceId = await this.mapper.resolveRuntimeInstanceId(agentId);
    if (!runtimeInstanceId) {
      return {
        agentId,
        pendingPermissions: [],
        issues: ["runtime_instance_missing"],
      };
    }
    if (!this.isConfigured()) {
      return {
        agentId,
        runtimeInstanceId,
        pendingPermissions: [],
        issues: ["daemon_not_configured"],
      };
    }
    try {
      await this.connect();
    } catch {
      return {
        agentId,
        runtimeInstanceId,
        pendingPermissions: [],
        issues: ["daemon_connect_failed"],
      };
    }
    if (!this.client) {
      return {
        agentId,
        runtimeInstanceId,
        pendingPermissions: [],
        issues: ["daemon_client_unavailable"],
      };
    }
    try {
      const snapshot = await this.client.fetchAgent(runtimeInstanceId);
      if (!snapshot) {
        return {
          agentId,
          runtimeInstanceId,
          pendingPermissions: [],
          issues: ["runtime_instance_not_found"],
        };
      }
      if (snapshot.lifecycle === "closed") {
        issues.push("runtime_closed");
      }
      if ((snapshot.pendingPermissions?.length ?? 0) > 0) {
        issues.push("permission_pending");
      }
      return {
        agentId,
        runtimeInstanceId,
        runtimeLifecycle: snapshot.lifecycle,
        pendingPermissions: snapshot.pendingPermissions ?? [],
        issues,
      };
    } catch {
      return {
        agentId,
        runtimeInstanceId,
        pendingPermissions: [],
        issues: ["runtime_fetch_failed"],
      };
    }
  }

  async respondToPermission(
    crewdenAgentId: string,
    permissionRequestId: string,
    response: PaseoPermissionResponse,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const runtimeInstanceId = await this.mapper.resolveRuntimeInstanceId(crewdenAgentId);
    if (!runtimeInstanceId) {
      return { ok: false, error: "runtime_instance_missing" };
    }
    if (!this.isConfigured()) {
      return { ok: false, error: "daemon_not_configured" };
    }
    try {
      await this.connect();
    } catch {
      return { ok: false, error: "daemon_connect_failed" };
    }
    if (!this.client) {
      return { ok: false, error: "daemon_client_unavailable" };
    }
    let snapshot: PaseoAgentSnapshot | undefined;
    try {
      snapshot = await this.client.fetchAgent(runtimeInstanceId);
    } catch {
      return { ok: false, error: "runtime_fetch_failed" };
    }
    if (!snapshot) {
      return { ok: false, error: "runtime_instance_not_found" };
    }
    const matched = snapshot.pendingPermissions?.some((permission) => permission.id === permissionRequestId);
    if (!matched) {
      return { ok: false, error: "permission_request_not_found" };
    }
    await this.client.respondToPermission(runtimeInstanceId, permissionRequestId, response);
    return { ok: true };
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

  private async fetchLiveRuntimeSnapshot(runtimeInstanceId: string): Promise<PaseoAgentSnapshot | undefined> {
    if (!this.client) return undefined;
    try {
      const snapshot = await this.client.fetchAgent(runtimeInstanceId);
      if (!snapshot) return undefined;
      return snapshot.lifecycle === 'closed' ? undefined : snapshot;
    } catch {
      return undefined;
    }
  }

  private async handleRuntimeAgentUpdate(runtimeInstanceId: string, snapshot: PaseoAgentSnapshot): Promise<void> {
    const crewdenAgentId = snapshot.labels?.crewdenAgentId ?? await this.mapper.resolveCrewdenAgentId(runtimeInstanceId);
    if (!crewdenAgentId) return;
    const mappedRuntimeId = await this.mapper.resolveRuntimeInstanceId(crewdenAgentId);
    if (mappedRuntimeId !== runtimeInstanceId) {
      await this.mapper.bind(crewdenAgentId, runtimeInstanceId);
    }
    await this.syncAgentStatus(crewdenAgentId, snapshot);
  }

  private async syncAgentStatus(crewdenAgentId: string, snapshot: PaseoAgentSnapshot): Promise<void> {
    const nextStatus = this.mapLifecycleToStatus(snapshot.lifecycle);
    const store = getStore();
    const current = await store.getAgent(crewdenAgentId);
    if (!current) return;
    if (current.status !== nextStatus) {
      const updated = await store.updateAgentStatus(crewdenAgentId, nextStatus);
      if (updated) eventBus.emit({ type: 'agent:update', agent: updated });
    }
    if (snapshot.sessionId) {
      const previousSession = this.sessionByAgentId.get(crewdenAgentId);
      if (previousSession !== snapshot.sessionId) {
        this.sessionByAgentId.set(crewdenAgentId, snapshot.sessionId);
        const activity = await store.createAgentActivity({
          id: crypto.randomUUID(),
          agentId: crewdenAgentId,
          type: 'working',
          detail: `session:${snapshot.sessionId}`,
        });
        eventBus.emit({ type: 'agent:activity', agentId: crewdenAgentId, activity });
      }
    }
  }

  private mapLifecycleToStatus(lifecycle: string): AgentStatus {
    switch (lifecycle) {
      case 'initializing':
        return 'starting';
      case 'running':
        return 'working';
      case 'idle':
        return 'idle';
      case 'error':
        return 'error';
      case 'closed':
        return 'inactive';
      default:
        return 'running';
    }
  }

  private async handleRuntimeStreamEvent(runtimeInstanceId: string, event: PaseoStreamEvent): Promise<void> {
    if (event.type === 'turn_started') {
      this.streamingMessageByRuntimeId.delete(runtimeInstanceId);
    }
    if (event.type === 'turn_completed' || event.type === 'turn_failed' || event.type === 'turn_canceled') {
      this.streamingMessageByRuntimeId.delete(runtimeInstanceId);
    }

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

    if (mapped.type === 'agent:session') {
      this.sessionByAgentId.set(crewdenAgentId, mapped.sessionId);
      const activity = await store.createAgentActivity({
        id: crypto.randomUUID(),
        agentId: crewdenAgentId,
        type: 'working',
        detail: `session:${mapped.sessionId}`,
      });
      eventBus.emit({ type: 'agent:activity', agentId: crewdenAgentId, activity });
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
      const currentStreamMessage = this.streamingMessageByRuntimeId.get(runtimeInstanceId);
      if (currentStreamMessage && currentStreamMessage.channelId === mapped.channelId) {
        const appended = await store.appendMessageContent(currentStreamMessage.messageId, mapped.content);
        if (appended) {
          eventBus.emit({ type: 'message:new', message: appended });
          return;
        }
        this.streamingMessageByRuntimeId.delete(runtimeInstanceId);
      }

      const created = await store.createMessage({
        id: crypto.randomUUID(),
        channelId: mapped.channelId,
        agentId: crewdenAgentId,
        senderName: agent?.displayName ?? agent?.name ?? crewdenAgentId,
        content: mapped.content,
      });
      this.streamingMessageByRuntimeId.set(runtimeInstanceId, {
        messageId: created.id,
        channelId: created.channelId,
      });
      eventBus.emit({ type: 'message:new', message: created });
    }
  }
}
