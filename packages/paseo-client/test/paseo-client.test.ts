import { describe, it, expect } from "vitest";
import { InboxAdapter } from "../src/inbox-adapter.js";
import { TimelineToEventBridge } from "../src/timeline-to-event-bridge.js";
import { CrewdenContextInjector } from "../src/crewden-context-injector.js";
import { mapRuntimeToProvider, supportsRuntime } from "../src/runtime-mapper.js";
import type { PaseoStreamEvent } from "../src/types.js";

describe("InboxAdapter", () => {
  it("delivers immediately when agent is idle", async () => {
    const adapter = new InboxAdapter();
    const sent: string[] = [];
    const send = async (_id: string, text: string) => {
      sent.push(text);
    };

    await adapter.enqueue("agent-1", {
      id: "msg-1",
      channelId: "general",
      channelName: "general",
      senderName: "user",
      content: "hello",
      createdAt: new Date().toISOString(),
    }, send);

    expect(sent).toEqual(["hello"]);
    expect(adapter.isProcessing("agent-1")).toBe(true);
  });

  it("queues messages when agent is busy", async () => {
    const adapter = new InboxAdapter();
    let resolveFirst: () => void = () => {};
    let firstStarted = false;
    const sent: string[] = [];
    const send = async (_id: string, text: string) => {
      if (sent.length === 0) {
        firstStarted = true;
        await new Promise<void>((r) => { resolveFirst = r; });
      }
      sent.push(text);
    };

    const delivery1 = {
      id: "msg-1",
      channelId: "general",
      channelName: "general",
      senderName: "user",
      content: "first",
      createdAt: new Date().toISOString(),
    };
    const delivery2 = {
      id: "msg-2",
      channelId: "general",
      channelName: "general",
      senderName: "user",
      content: "second",
      createdAt: new Date().toISOString(),
    };

    const p1 = adapter.enqueue("agent-1", delivery1, send);

    await new Promise((r) => setTimeout(r, 10));
    expect(firstStarted).toBe(true);

    adapter.enqueue("agent-1", delivery2, send);
    expect(adapter.queueLength("agent-1")).toBe(1);

    resolveFirst();
    await p1;
    await adapter.onAgentIdle("agent-1", send);

    expect(sent).toEqual(["first", "second"]);
  });
});

describe("TimelineToEventBridge", () => {
  it("accumulates assistant_message from timeline events", () => {
    const bridge = new TimelineToEventBridge();

    const result = bridge.mapStreamEvent(
      { type: "timeline", item: { type: "assistant_message", text: "Hello world" } } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("agent:message");
    if (result?.type === "agent:message") {
      expect(result.content).toBe("Hello world");
    }
  });

  it("maps CREWDEN_SEND_MESSAGE marker output to plain content", () => {
    const bridge = new TimelineToEventBridge();
    const result = bridge.mapStreamEvent(
      {
        type: "timeline",
        item: {
          type: "assistant_message",
          text: '[[CREWDEN_SEND_MESSAGE]] {"content":"收到"}',
        },
      } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("agent:message");
    if (result?.type === "agent:message") {
      expect(result.content).toBe("收到");
    }
  });

  it("buffers fragmented CREWDEN_SEND_MESSAGE marker output", () => {
    const bridge = new TimelineToEventBridge();
    const first = bridge.mapStreamEvent(
      {
        type: "timeline",
        item: { type: "assistant_message", text: "[[CRE" },
      } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(first).toBeNull();

    const second = bridge.mapStreamEvent(
      {
        type: "timeline",
        item: { type: "assistant_message", text: 'WDEN_SEND_MESSAGE]] {"content":"收' },
      } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(second).toBeNull();

    const third = bridge.mapStreamEvent(
      {
        type: "timeline",
        item: { type: "assistant_message", text: '到"}' },
      } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(third?.type).toBe("agent:message");
    if (third?.type === "agent:message") {
      expect(third.content).toBe("收到");
    }
  });

  it("detects crewden tool calls from timeline items", () => {
    const bridge = new TimelineToEventBridge();
    const result = bridge.mapStreamEvent(
      { type: "timeline", item: { type: "tool_call", toolName: "crewden_send_message", args: { content: "hi" } } } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("crewden:tool_call");
  });

  it("detects mcp__crewden__ prefixed tools", () => {
    const bridge = new TimelineToEventBridge();
    const result = bridge.mapStreamEvent(
      { type: "timeline", item: { type: "tool_call", toolName: "mcp__crewden__send_message" } } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("crewden:tool_call");
  });

  it("maps turn_completed to idle activity", () => {
    const bridge = new TimelineToEventBridge();
    const result = bridge.mapStreamEvent(
      { type: "turn_completed" } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("agent:activity");
    if (result?.type === "agent:activity") {
      expect(result.activityType).toBe("idle");
    }
  });

  it("maps turn_failed to error activity", () => {
    const bridge = new TimelineToEventBridge();
    const result = bridge.mapStreamEvent(
      { type: "turn_failed", error: "something broke" } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("agent:activity");
    if (result?.type === "agent:activity") {
      expect(result.activityType).toBe("error");
      expect(result.detail).toBe("something broke");
    }
  });

  it("maps thread_started to agent session event", () => {
    const bridge = new TimelineToEventBridge();
    const result = bridge.mapStreamEvent(
      { type: "thread_started", sessionId: "sess-123" } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("agent:session");
    if (result?.type === "agent:session") {
      expect(result.sessionId).toBe("sess-123");
    }
  });

  it("maps permission events to activities", () => {
    const bridge = new TimelineToEventBridge();
    const requested = bridge.mapStreamEvent(
      { type: "permission_requested" } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(requested?.type).toBe("agent:activity");
    if (requested?.type === "agent:activity") {
      expect(requested.detail).toBe("permission:requested");
    }
    const resolved = bridge.mapStreamEvent(
      { type: "permission_resolved", requestId: "per-1" } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(resolved?.type).toBe("agent:activity");
    if (resolved?.type === "agent:activity") {
      expect(resolved.detail).toBe("permission:resolved:per-1");
    }
  });

  it("maps turn_canceled to error activity", () => {
    const bridge = new TimelineToEventBridge();
    const result = bridge.mapStreamEvent(
      { type: "turn_canceled", reason: "interrupted" } as PaseoStreamEvent,
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("agent:activity");
    if (result?.type === "agent:activity") {
      expect(result.activityType).toBe("error");
      expect(result.detail).toBe("turn_canceled:interrupted");
    }
  });
});

describe("CrewdenContextInjector", () => {
  it("builds deliver prompt with inbox summary", () => {
    const injector = new CrewdenContextInjector();
    const prompt = injector.buildDeliverPrompt({
      delivery: {
        id: "msg-1",
        channelId: "general",
        channelName: "general",
        senderName: "Alice",
        content: "Do something",
        createdAt: "2026-01-01T00:00:00Z",
      },
      inboxSummary: "2 open tasks",
      agentId: "agent-1",
      channelId: "general",
    });
    expect(prompt).toContain("Current task inbox summary");
    expect(prompt).toContain("Do something");
    expect(prompt).toContain("Alice");
  });

  it("builds MCP config with stdio transport", () => {
    const injector = new CrewdenContextInjector();
    const config = injector.buildMcpConfig({
      agentId: "agent-1",
      serverUrl: "http://localhost:3000",
      agentToken: "tok123",
      mcpBridgeBin: "/path/to/bin.js",
    });
    expect(config.crewden.type).toBe("stdio");
    expect(config.crewden.args).toContain("--agent-id");
  });
});

describe("runtime-mapper", () => {
  it("maps claude to claude", () => {
    expect(mapRuntimeToProvider("claude")).toBe("claude");
  });

  it("maps codex to codex", () => {
    expect(mapRuntimeToProvider("codex")).toBe("codex");
  });

  it("maps opencode to opencode", () => {
    expect(mapRuntimeToProvider("opencode")).toBe("opencode");
  });

  it("maps pi to pi", () => {
    expect(mapRuntimeToProvider("pi")).toBe("pi");
  });

  it("throws for gemini", () => {
    expect(() => mapRuntimeToProvider("gemini")).toThrow("not supported");
  });

  it("supportsRuntime returns correct values", () => {
    expect(supportsRuntime("claude")).toBe(true);
    expect(supportsRuntime("codex")).toBe(true);
    expect(supportsRuntime("opencode")).toBe(true);
    expect(supportsRuntime("pi")).toBe(true);
    expect(supportsRuntime("gemini")).toBe(false);
  });
});
