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

/**
 * Paseo timeline item types.
 * @see Paseo packages/server/src/shared/messages.ts AgentTimelineItemPayloadSchema
 */
export type PaseoTimelineItem =
  | { type: "user_message"; text: string; messageId?: string }
  | { type: "assistant_message"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; toolName: string; args?: unknown; toolCallId?: string }
  | { type: "todo"; items: Array<{ text: string; completed: boolean }> }
  | { type: "error"; message: string }
  | { type: "compaction"; status: "loading" | "completed"; trigger?: "auto" | "manual" };

/**
 * Paseo AgentStreamEvent payload types.
 * @see Paseo packages/server/src/shared/messages.ts AgentStreamEventPayloadSchema
 */
export type PaseoStreamEvent =
  | { type: "thread_started"; sessionId?: string; provider?: string }
  | { type: "turn_started"; provider?: string }
  | { type: "turn_completed"; provider?: string }
  | { type: "turn_failed"; error: string; code?: string; provider?: string }
  | { type: "turn_canceled"; reason: string; provider?: string }
  | { type: "timeline"; item: PaseoTimelineItem; provider?: string; seq?: number; epoch?: string }
  | { type: "permission_requested"; provider?: string }
  | { type: "permission_resolved"; requestId: string; provider?: string }
  | { type: "attention_required"; reason: string; timestamp?: string; provider?: string };

export type PaseoAgentSnapshot = {
  id: string;
  lifecycle: string;
  provider: string;
  cwd: string;
  sessionId?: string;
  updatedAt?: string;
  pendingPermissions?: Array<{
    id: string;
    name: string;
    kind: "tool" | "plan" | "question" | "mode" | "other";
    title?: string;
    description?: string;
    actions?: Array<{
      id: string;
      label: string;
      behavior: "allow" | "deny";
      variant?: "primary" | "secondary" | "danger";
      intent?: "implement" | "implement_resume" | "dismiss";
    }>;
  }>;
  title?: string;
  labels?: Record<string, string>;
};
