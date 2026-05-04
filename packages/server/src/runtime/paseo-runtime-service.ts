import { nanoid } from 'nanoid';
import type { Agent, AgentDelivery, AgentRuntimeConfig, WorkspaceEntry, WorkspaceError } from '@crewden/shared';
import { toAgentRuntimeConfig } from './agent-runtime-config.js';
import { PaseoDaemonMode } from '../agent-runtime-bridge/paseo-daemon-mode.js';
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
    const fallbackReason = !this.paseoBridge.isConfigured()
      ? 'PASEO_DAEMON_URL is missing.'
      : undefined;
    return {
      configuredMode: 'paseo-daemon',
      effectiveMode: 'paseo-daemon',
      connected: this.paseoBridge.connected,
      fallbackReason,
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
    inboxSummary?: string;
  }): Promise<boolean> {
    try {
      return await this.paseoBridge.deliverMessage({
        agent: params.target,
        seq: params.seq,
        channelId: params.channelId,
        message: params.message,
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
}

export const paseoRuntimeService = new PaseoRuntimeService();
