import { nanoid } from 'nanoid';
import type { Agent, AgentDelivery, AgentRuntimeConfig, WorkspaceEntry, WorkspaceError } from '@crewden/shared';
import { toAgentRuntimeConfig } from './agent-runtime-config.js';
import { PaseoDaemonMode } from '../agent-runtime-bridge/paseo-daemon-mode.js';
import { getStore } from '../db.js';
import type { RuntimeStatusSnapshot } from '../agent-runtime-bridge/types.js';

export class PaseoRuntimeService {
  private readonly paseoBridge: PaseoDaemonMode;

  constructor() {
    this.paseoBridge = new PaseoDaemonMode({
      daemonUrl: process.env.PASEO_DAEMON_URL,
      apiKey: process.env.PASEO_DAEMON_API_KEY,
      workspaceRoot: process.env.CREWDEN_PASEO_WORKSPACE_ROOT,
      mcpBridgeBin: process.env.CREWDEN_MCP_BRIDGE_BIN,
      serverUrl: process.env.CREWDEN_SERVER_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`,
    });
  }

  async connect(): Promise<void> {
    await this.paseoBridge.connect();
  }

  getStatus(): RuntimeStatusSnapshot {
    const diagnostics: string[] = [];
    const daemonUrl = process.env.PASEO_DAEMON_URL;
    const mcpBridgeBin = process.env.CREWDEN_MCP_BRIDGE_BIN;
    const mcpBridgeReady = Boolean(mcpBridgeBin);
    const fallbackReason = !this.paseoBridge.isConfigured()
      ? 'PASEO_DAEMON_URL is missing.'
      : undefined;
    if (!daemonUrl) diagnostics.push('PASEO_DAEMON_URL is not set');
    if (!mcpBridgeBin) diagnostics.push('CREWDEN_MCP_BRIDGE_BIN is not set');
    return {
      configuredMode: 'paseo-daemon',
      effectiveMode: 'paseo-daemon',
      connected: this.paseoBridge.connected,
      fallbackReason,
      daemonUrl,
      mcpBridgeBin,
      mcpBridgeReady,
      diagnostics: diagnostics.length ? diagnostics : undefined,
    };
  }

  resolveStartMachineId(agent: Agent): string {
    return agent.machineId ?? 'paseo-runtime';
  }

  async startAgent(params: {
    agent: Agent;
    machineId: string;
    launchId?: string;
    config?: AgentRuntimeConfig;
    wakeMessage?: AgentDelivery;
    inboxSummary?: string;
  }): Promise<boolean> {
    const config = params.config ?? await toAgentRuntimeConfig(params.agent);
    try {
      return await this.paseoBridge.startAgent({
        agent: params.agent,
        machineId: params.machineId,
        launchId: params.launchId ?? nanoid(),
        config,
        wakeMessage: params.wakeMessage,
        inboxSummary: params.inboxSummary,
      });
    } catch {
      return false;
    }
  }

  async stopAgent(agent: Agent): Promise<boolean> {
    try {
      return await this.paseoBridge.stopAgent(agent);
    } catch {
      return false;
    }
  }

  async deliverMessage(params: {
    target: Agent;
    seq: number;
    channelId: string;
    message: AgentDelivery;
    deliveryBehavior?: 'interrupt' | 'queue';
    inboxSummary?: string;
  }): Promise<boolean> {
    try {
      return await this.paseoBridge.deliverMessage({
        agent: params.target,
        seq: params.seq,
        channelId: params.channelId,
        message: params.message,
        deliveryBehavior: params.deliveryBehavior,
        inboxSummary: params.inboxSummary,
      });
    } catch {
      return false;
    }
  }

  async readWorkspace(agent: Agent, relPath: string): Promise<WorkspaceEntry | WorkspaceError> {
    if (!this.paseoBridge.isConfigured()) {
      return { type: 'error', status: 503, error: 'Paseo daemon is not configured' };
    }
    return this.paseoBridge.readWorkspace({
      agent,
      machineId: this.resolveStartMachineId(agent),
      requestId: nanoid(),
      relPath,
    });
  }

  async getHealthReport(): Promise<{
    disconnectedWithActiveAgents: boolean;
    agents: Array<{
      id: string;
      name: string;
      status: string;
      runtimeInstanceId?: string;
      runtimeLifecycle?: string;
      pendingPermissions: Array<{
        id: string;
        name: string;
        kind: 'tool' | 'plan' | 'question' | 'mode' | 'other';
        title?: string;
        description?: string;
        actions?: Array<{
          id: string;
          label: string;
          behavior: 'allow' | 'deny';
          variant?: 'primary' | 'secondary' | 'danger';
          intent?: 'implement' | 'implement_resume' | 'dismiss';
        }>;
      }>;
      issues: string[];
      lastActivityAt?: string;
    }>;
  }> {
    const store = getStore();
    const agents = await store.listAgents();
    const connected = this.paseoBridge.connected;
    const activeStatuses = new Set(['starting', 'running', 'working']);
    const disconnectedWithActiveAgents = !connected && agents.some((agent) => activeStatuses.has(agent.status));
    const now = Date.now();
    const thresholdMs = 2 * 60 * 1000;

    const reportAgents = await Promise.all(agents.map(async (agent) => {
      const latestActivity = (await store.listAgentActivities(agent.id, 1))[0];
      const health = await this.paseoBridge.inspectRuntimeAgent(agent.id);
      const issues = [...health.issues];
      if (health.runtimeLifecycle === 'running' && !activeStatuses.has(agent.status)) {
        issues.push('state_mismatch_running_vs_idle');
      }
      if (
        activeStatuses.has(agent.status) &&
        latestActivity?.createdAt &&
        now - new Date(latestActivity.createdAt).getTime() > thresholdMs
      ) {
        issues.push('stream_stalled');
      }
      return {
        id: agent.id,
        name: agent.displayName ?? agent.name,
        status: agent.status,
        runtimeInstanceId: health.runtimeInstanceId,
        runtimeLifecycle: health.runtimeLifecycle,
        pendingPermissions: health.pendingPermissions,
        issues,
        lastActivityAt: latestActivity?.createdAt,
      };
    }));

    return {
      disconnectedWithActiveAgents,
      agents: reportAgents,
    };
  }

  async respondToPermission(params: {
    agentId: string;
    permissionRequestId: string;
    response:
      | {
          behavior: 'allow';
          selectedActionId?: string;
          updatedInput?: Record<string, unknown>;
          updatedPermissions?: Record<string, unknown>[];
        }
      | {
          behavior: 'deny';
          selectedActionId?: string;
          message?: string;
          interrupt?: boolean;
        };
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.paseoBridge.respondToPermission(
      params.agentId,
      params.permissionRequestId,
      params.response,
    );
  }
}

export const paseoRuntimeService = new PaseoRuntimeService();
