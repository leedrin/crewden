import { join } from "path";
import type { AgentDelivery, RuntimeId } from "@crewden/shared";
import type { McpServerConfig } from "./types.js";

export class CrewdenContextInjector {
  buildDeliverPrompt(params: {
    delivery: AgentDelivery;
    inboxSummary?: string;
    agentId: string;
    channelId: string;
  }): string {
    const parts: string[] = [];
    if (params.inboxSummary) {
      parts.push("Current task inbox summary:", params.inboxSummary);
    }
    if (params.delivery.threadRootId) {
      parts.push(
        `This message is inside thread ${params.delivery.threadRootId}. Keep replies in that thread.`,
      );
    }
    parts.push(
      `[target=#${params.delivery.channelName} msg=${params.delivery.id} time=${params.delivery.createdAt}] ` +
        `@${params.delivery.senderName}: ${params.delivery.content}`,
    );
    return parts.join("\n\n");
  }

  buildMcpConfig(params: {
    agentId: string;
    serverUrl: string;
    agentToken: string;
    mcpBridgeBin: string;
  }): Record<string, McpServerConfig> {
    return {
      crewden: {
        type: "stdio",
        command: "node",
        args: [
          params.mcpBridgeBin,
          "--agent-id",
          params.agentId,
          "--server-url",
          params.serverUrl,
          "--auth-token",
          params.agentToken,
        ],
      },
    };
  }

  buildSystemPromptAppendix(): string {
    return [
      "You have access to crewden collaboration tools via MCP.",
      "Use MCP tools for message sending, DMs, delegation, task management, and knowledge.",
      "Prefer MCP tools over CLI commands when available.",
      "Use `crewden_inbox` first to inspect assigned work and pending blockers/reviews.",
      "Use `crewden_check_messages` to check for queued messages.",
      "Use `crewden_list_tasks` and `crewden_get_task` to inspect task details.",
      "Use `crewden_delegate` to delegate work to another agent.",
      "If MCP tools are unavailable, send a chat reply by outputting exactly one line:",
      '[[CREWDEN_SEND_MESSAGE]] {"content":"your message here"}',
    ].join("\n");
  }
}
