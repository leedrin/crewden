import type { PaseoStreamEvent, CrewdenEvent } from "./types.js";

const CREWDEN_TOOL_PREFIX = "crewden_";
const CREWDEN_SEND_MESSAGE_MARKER = "[[CREWDEN_SEND_MESSAGE]]";

/**
 * Maps Paseo AgentStreamEvent types to Crewden events.
 *
 * Paseo agent_stream event types:
 *   - thread_started / turn_started / turn_completed / turn_failed / turn_canceled
 *   - timeline (contains item with type: user_message, assistant_message, reasoning, tool_call, todo, error, compaction)
 *   - permission_requested / permission_resolved
 *   - attention_required
 *
 * @see Paseo packages/server/src/shared/messages.ts AgentStreamEventPayloadSchema
 */
export class TimelineToEventBridge {
  private readonly pendingSendMessageChunks = new Map<string, string>();

  mapStreamEvent(
    event: PaseoStreamEvent,
    agentId: string,
    channelId: string,
  ): CrewdenEvent | null {
    switch (event.type) {
      case "timeline": {
        const item = event.item;
        if (!item) return null;

        switch (item.type) {
          case "assistant_message":
            {
              const content = this.normalizeAssistantMessage(agentId, item.text ?? "");
              if (content == null || content === "") return null;
              return {
                type: "agent:message",
                agentId,
                channelId,
                content,
              };
            }

          case "reasoning":
            return {
              type: "agent:activity",
              agentId,
              activityType: "thinking",
              detail: item.text,
            };

          case "tool_call": {
            const toolName = item.toolName ?? "";
            if (isCrewdenTool(toolName)) {
              return {
                type: "crewden:tool_call",
                agentId,
                toolName,
                args: item.args,
              };
            }
            return {
              type: "agent:activity",
              agentId,
              activityType: "working",
              detail: `tool:${toolName}`,
            };
          }

          case "error":
            return {
              type: "agent:activity",
              agentId,
              activityType: "error",
              detail: item.message,
            };

          default:
            return { type: "agent:activity", agentId, activityType: "working" };
        }
      }

      case "turn_completed":
        return { type: "agent:activity", agentId, activityType: "idle" };

      case "turn_started":
        return { type: "agent:activity", agentId, activityType: "working" };

      case "turn_failed":
        return { type: "agent:activity", agentId, activityType: "error", detail: event.error };

      case "turn_canceled":
        return {
          type: "agent:activity",
          agentId,
          activityType: "error",
          detail: `turn_canceled:${event.reason}`,
        };

      case "permission_requested":
        return {
          type: "agent:activity",
          agentId,
          activityType: "working",
          detail: "permission:requested",
        };

      case "permission_resolved":
        return {
          type: "agent:activity",
          agentId,
          activityType: "working",
          detail: `permission:resolved:${event.requestId}`,
        };

      case "attention_required":
        return {
          type: "agent:activity",
          agentId,
          activityType: "error",
          detail: `attention:${event.reason}`,
        };

      case "thread_started":
        if (!event.sessionId) return null;
        return { type: "agent:session", agentId, sessionId: event.sessionId };

      default:
        return null;
    }
  }

  clear(agentId: string): void {
    this.pendingSendMessageChunks.delete(agentId);
  }

  private normalizeAssistantMessage(agentId: string, text: string): string | null {
    const pending = this.pendingSendMessageChunks.get(agentId);
    if (pending) {
      const combined = `${pending}${text}`;
      const result = parseSendMessageControl(combined);
      if (result.status === "pending") {
        this.pendingSendMessageChunks.set(agentId, combined);
        return null;
      }
      this.pendingSendMessageChunks.delete(agentId);
      return result.status === "complete" ? result.content : combined;
    }

    const trimmedStart = text.trimStart();
    if (trimmedStart.startsWith("[[CRE")) {
      const result = parseSendMessageControl(trimmedStart);
      if (result.status === "pending") {
        this.pendingSendMessageChunks.set(agentId, trimmedStart);
        return null;
      }
      return result.status === "complete" ? result.content : text;
    }

    return text;
  }
}

function isCrewdenTool(toolName: string): boolean {
  return toolName.startsWith(CREWDEN_TOOL_PREFIX) || toolName.startsWith("mcp__crewden__");
}

type SendMessageParseResult =
  | { status: "pending" }
  | { status: "invalid" }
  | { status: "complete"; content: string };

function parseSendMessageControl(text: string): SendMessageParseResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith(CREWDEN_SEND_MESSAGE_MARKER)) {
    return trimmed.startsWith("[[CRE") ? { status: "pending" } : { status: "invalid" };
  }

  const payloadText = trimmed.slice(CREWDEN_SEND_MESSAGE_MARKER.length).trim();
  if (!payloadText) return { status: "pending" };

  try {
    const payload = JSON.parse(payloadText) as { content?: unknown };
    if (typeof payload.content === "string") {
      return { status: "complete", content: payload.content };
    }
    return { status: "complete", content: "" };
  } catch {
    return payloadText.endsWith("}") ? { status: "invalid" } : { status: "pending" };
  }
}
