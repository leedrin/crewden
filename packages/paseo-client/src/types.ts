import type { AgentDelivery } from "@crewden/shared";

export type Unsubscribe = () => void;

export type PaseoConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type CrewdenEvent =
  | { type: "agent:message"; agentId: string; channelId: string; content: string; inReplyToMessageId?: string }
  | { type: "agent:status"; agentId: string; status: string }
  | { type: "agent:activity"; agentId: string; activityType: string; detail?: string }
  | { type: "crewden:tool_call"; agentId: string; toolName: string; args?: unknown }
  | { type: "agent:session"; agentId: string; sessionId: string };

export type AgentMessageEvent = Extract<CrewdenEvent, { type: "agent:message" }>;
export type AgentActivityEvent = Extract<CrewdenEvent, { type: "agent:activity" }>;

export type RuntimeInfo = {
  id: string;
  version: string;
};

export type McpServerConfig =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

export type CreatePaseoAgentOptions = {
  provider: string;
  cwd: string;
  model?: string;
  systemPrompt?: string;
  initialPrompt?: string;
  mcpServers?: Record<string, McpServerConfig>;
  labels?: Record<string, string>;
};

export type PaseoStreamEvent = {
  type: string;
  timestamp?: string;
  text?: string;
  toolCall?: { name: string; args?: unknown };
  reason?: string;
  error?: string;
};

export type PaseoAgentSnapshot = {
  id: string;
  lifecycle: string;
  provider: string;
  cwd: string;
  title?: string;
  labels?: Record<string, string>;
};
