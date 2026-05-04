import type { Agent, AgentDelivery, AgentRuntimeConfig, WorkspaceEntry, WorkspaceError } from '@crewden/shared';

export type RuntimeMode = 'paseo-daemon' | 'legacy-local';

export type RuntimeStatusSnapshot = {
  configuredMode: RuntimeMode;
  effectiveMode: RuntimeMode;
  connected: boolean;
  fallbackReason?: string;
};

export type StartAgentParams = {
  agent: Agent;
  machineId: string;
  launchId: string;
  config: AgentRuntimeConfig;
  wakeMessage?: AgentDelivery;
  inboxSummary?: string;
};

export type DeliverMessageParams = {
  agent: Agent;
  seq: number;
  channelId: string;
  message: AgentDelivery;
  config?: AgentRuntimeConfig;
  inboxSummary?: string;
};

export type ReadWorkspaceParams = {
  agent: Agent;
  machineId: string;
  requestId: string;
  relPath: string;
};

export interface AgentRuntimeBridge {
  readonly mode: RuntimeMode;
  readonly connected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listConnectedMachineIds(): string[];
  startAgent(params: StartAgentParams): Promise<boolean>;
  stopAgent(agent: Agent): Promise<boolean>;
  deliverMessage(params: DeliverMessageParams): Promise<boolean>;
  readWorkspace(params: ReadWorkspaceParams): Promise<WorkspaceEntry | WorkspaceError>;
}
