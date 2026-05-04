import type { Agent, WorkspaceEntry, WorkspaceError } from '@crewden/shared';
import { daemonRegistry } from '../daemonRegistry.js';
import type { AgentRuntimeBridge, DeliverMessageParams, ReadWorkspaceParams, StartAgentParams } from './types.js';

export class LegacyLocalRuntimeAdapter implements AgentRuntimeBridge {
  readonly mode = 'legacy-local' as const;

  get connected(): boolean {
    return this.listConnectedMachineIds().length > 0;
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  listConnectedMachineIds(): string[] {
    return daemonRegistry.listConnectedMachineIds();
  }

  async startAgent(params: StartAgentParams): Promise<boolean> {
    return daemonRegistry.send(params.machineId, {
      type: 'agent:start',
      agentId: params.agent.id,
      config: params.config,
      launchId: params.launchId,
      wakeMessage: params.wakeMessage,
      inboxSummary: params.inboxSummary,
    });
  }

  async stopAgent(agent: Agent): Promise<boolean> {
    if (!agent.machineId) return false;
    return daemonRegistry.send(agent.machineId, { type: 'agent:stop', agentId: agent.id });
  }

  async deliverMessage(params: DeliverMessageParams): Promise<boolean> {
    if (!params.agent.machineId) return false;
    return daemonRegistry.send(params.agent.machineId, {
      type: 'agent:deliver',
      agentId: params.agent.id,
      seq: params.seq,
      channelId: params.channelId,
      config: params.config,
      message: params.message,
      inboxSummary: params.inboxSummary,
    });
  }

  async readWorkspace(params: ReadWorkspaceParams): Promise<WorkspaceEntry | WorkspaceError> {
    return daemonRegistry.readWorkspace(params.machineId, params.agent.id, params.requestId, params.relPath);
  }
}
