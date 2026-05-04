import type { PaseoStreamEvent, CrewdenEvent } from "./types.js";

const CREWDEN_TOOL_PREFIX = "crewden_";

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
            return {
              type: "agent:message",
              agentId,
              channelId,
              content: item.text ?? "",
            };

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
        return { type: "agent:status", agentId, status: "idle" };

      case "turn_started":
        return { type: "agent:activity", agentId, activityType: "working" };

      case "turn_failed":
        return { type: "agent:status", agentId, status: "error" };

      case "thread_started":
        return null;

      default:
        return null;
    }
  }

  clear(_agentId: string): void {}
}

function isCrewdenTool(toolName: string): boolean {
  return toolName.startsWith(CREWDEN_TOOL_PREFIX) || toolName.startsWith("mcp__crewden__");
}
