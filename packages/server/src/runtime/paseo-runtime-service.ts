import { nanoid } from 'nanoid';
import { resolveStartMachineId, toRuntimeConfig } from '@crewden/hub-core';
import type { Agent, AgentDelivery, AgentRuntimeConfig, WorkspaceEntry, WorkspaceError } from '@crewden/shared';
import { getStore } from '../db.js';
import { toAgentRuntimeConfig } from '../runtimeConfig.js';
import { LegacyLocalRuntimeAdapter } from '../agent-runtime-bridge/legacy-local-runtime-adapter.js';
import { PaseoDaemonMode } from '../agent-runtime-bridge/paseo-daemon-mode.js';
import type { AgentRuntimeBridge, RuntimeMode, RuntimeStatusSnapshot } from '../agent-runtime-bridge/types.js';

const LEGACY_MODE_ALIASES = new Set(['legacy-local', 'local-daemon', 'daemon']);

function parseConfiguredMode(): RuntimeMode {
  const explicit = process.env.CREWDEN_RUNTIME_MODE?.trim().toLowerCase();
  if (explicit === 'legacy-local') return 'legacy-local';
  if (explicit === 'paseo-daemon') return 'paseo-daemon';

  const legacyCompat = process.env.CREWDEN_DAEMON_MODE?.trim().toLowerCase();
  if (legacyCompat && LEGACY_MODE_ALIASES.has(legacyCompat)) return 'legacy-local';
  if (legacyCompat === 'paseo' || legacyCompat === 'paseo-daemon') return 'paseo-daemon';

  return 'paseo-daemon';
}

export class PaseoRuntimeService {
  private readonly configuredMode: RuntimeMode;
  private readonly legacyBridge: AgentRuntimeBridge;
  private readonly paseoBridge: PaseoDaemonMode;

  constructor() {
    this.configuredMode = parseConfiguredMode();
    this.legacyBridge = new LegacyLocalRuntimeAdapter();
    this.paseoBridge = new PaseoDaemonMode({
      daemonUrl: process.env.PASEO_DAEMON_URL,
      apiKey: process.env.PASEO_DAEMON_API_KEY,
      workspaceRoot: process.env.CREWDEN_PASEO_WORKSPACE_ROOT,
      mcpBridgeBin: process.env.CREWDEN_MCP_BRIDGE_BIN,
      serverUrl: process.env.CREWDEN_SERVER_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`,
    });
  }

  async connect(): Promise<void> {
    const bridge = this.resolveBridge();
    await bridge.connect();
  }

  getStatus(): RuntimeStatusSnapshot {
    const fallbackReason = this.configuredMode === 'paseo-daemon' && !this.paseoBridge.isConfigured()
      ? 'PASEO_DAEMON_URL is missing; fallback to legacy-local.'
      : undefined;
    const effectiveBridge = this.resolveBridge();
    return {
      configuredMode: this.configuredMode,
      effectiveMode: effectiveBridge.mode,
      connected: effectiveBridge.connected,
      fallbackReason,
    };
  }

  async resolveStartMachineId(agent: Agent): Promise<string | undefined> {
    const bridge = this.resolveBridge();
    if (bridge.mode === 'paseo-daemon') {
      return agent.machineId ?? 'paseo-runtime';
    }
    return resolveStartMachineId({
      agent,
      machines: await getStore().listMachines(),
      connectedMachineIds: new Set(bridge.listConnectedMachineIds()),
    });
  }

  async startAgent(params: {
    agent: Agent;
    machineId: string;
    launchId?: string;
    config?: AgentRuntimeConfig;
    wakeMessage?: AgentDelivery;
    inboxSummary?: string;
  }): Promise<boolean> {
    const bridge = this.resolveBridge();
    const config = params.config ?? await toAgentRuntimeConfig(params.agent);
    return bridge.startAgent({
      agent: params.agent,
      machineId: params.machineId,
      launchId: params.launchId ?? nanoid(),
      config,
      wakeMessage: params.wakeMessage,
      inboxSummary: params.inboxSummary,
    });
  }

  async stopAgent(agent: Agent): Promise<boolean> {
    return this.resolveBridge().stopAgent(agent);
  }

  async deliverMessage(params: {
    target: Agent;
    seq: number;
    channelId: string;
    message: AgentDelivery;
    inboxSummary?: string;
  }): Promise<boolean> {
    const bridge = this.resolveBridge();
    const config = bridge.mode === 'legacy-local' ? toRuntimeConfig(params.target) : undefined;
    return bridge.deliverMessage({
      agent: params.target,
      seq: params.seq,
      channelId: params.channelId,
      message: params.message,
      config,
      inboxSummary: params.inboxSummary,
    });
  }

  async readWorkspace(agent: Agent, relPath: string): Promise<WorkspaceEntry | WorkspaceError> {
    const bridge = this.resolveBridge();
    const machineId = await this.resolveStartMachineId(agent);
    if (!machineId) {
      return { type: 'error', status: 503, error: 'No connected machine available for agent workspace' };
    }
    return bridge.readWorkspace({
      agent,
      machineId,
      requestId: nanoid(),
      relPath,
    });
  }

  private resolveBridge(): AgentRuntimeBridge {
    if (this.configuredMode === 'legacy-local') return this.legacyBridge;
    if (this.paseoBridge.isConfigured()) return this.paseoBridge;
    return this.legacyBridge;
  }
}

export const paseoRuntimeService = new PaseoRuntimeService();
