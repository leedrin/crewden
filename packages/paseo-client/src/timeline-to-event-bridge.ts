import type { PaseoStreamEvent, CrewdenEvent } from "./types.js";

const CREWDEN_TOOL_PREFIX = "crewden_";

export class TimelineToEventBridge {
  private accumulatedText = new Map<string, string>();

  mapStreamEvent(
    event: PaseoStreamEvent,
    agentId: string,
    channelId: string,
  ): CrewdenEvent | null {
    switch (event.type) {
      case "text_delta":
      case "assistant_text": {
        const current = this.accumulatedText.get(agentId) ?? "";
        if (event.text) {
          this.accumulatedText.set(agentId, current + event.text);
        }
        return { type: "agent:activity", agentId, activityType: "working" };
      }

      case "run_finished":
      case "result": {
        const content = this.accumulatedText.get(agentId) ?? "";
        this.accumulatedText.delete(agentId);
        if (content) {
          return {
            type: "agent:message",
            agentId,
            channelId,
            content,
          };
        }
        return { type: "agent:status", agentId, status: "idle" };
      }

      case "tool_invocation":
      case "tool_call": {
        const toolName = event.toolCall?.name ?? "";
        if (isCrewdenTool(toolName)) {
          return {
            type: "crewden:tool_call",
            agentId,
            toolName,
            args: event.toolCall?.args,
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
          type: "agent:status",
          agentId,
          status: "error",
        };

      case "thinking":
        return { type: "agent:activity", agentId, activityType: "thinking" };

      default:
        return null;
    }
  }

  flushAccumulatedText(agentId: string): string {
    const text = this.accumulatedText.get(agentId) ?? "";
    this.accumulatedText.delete(agentId);
    return text;
  }

  clear(agentId: string): void {
    this.accumulatedText.delete(agentId);
  }
}

function isCrewdenTool(toolName: string): boolean {
  return toolName.startsWith(CREWDEN_TOOL_PREFIX) || toolName.startsWith("mcp__crewden__");
}
