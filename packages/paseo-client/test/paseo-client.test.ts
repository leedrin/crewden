import { describe, it, expect } from "vitest";
import { InboxAdapter } from "../src/inbox-adapter.js";
import { TimelineToEventBridge } from "../src/timeline-to-event-bridge.js";
import { CrewdenContextInjector } from "../src/crewden-context-injector.js";
import { mapRuntimeToProvider, supportsRuntime } from "../src/runtime-mapper.js";

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
  it("accumulates text and emits message on run_finished", () => {
    const bridge = new TimelineToEventBridge();

    const textEvent = bridge.mapStreamEvent(
      { type: "text_delta", text: "Hello " },
      "agent-1",
      "general",
    );
    expect(textEvent?.type).toBe("agent:activity");

    bridge.mapStreamEvent(
      { type: "text_delta", text: "world" },
      "agent-1",
      "general",
    );

    const finished = bridge.mapStreamEvent(
      { type: "run_finished" },
      "agent-1",
      "general",
    );
    expect(finished?.type).toBe("agent:message");
    if (finished?.type === "agent:message") {
      expect(finished.content).toBe("Hello world");
    }
  });

  it("detects crewden tool calls", () => {
    const bridge = new TimelineToEventBridge();
    const result = bridge.mapStreamEvent(
      { type: "tool_invocation", toolCall: { name: "crewden_send_message", args: { content: "hi" } } },
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("crewden:tool_call");
  });

  it("detects mcp__crewden__ prefixed tools", () => {
    const bridge = new TimelineToEventBridge();
    const result = bridge.mapStreamEvent(
      { type: "tool_call", toolCall: { name: "mcp__crewden__send_message" } },
      "agent-1",
      "general",
    );
    expect(result?.type).toBe("crewden:tool_call");
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
  it("maps claude to claude-code", () => {
    expect(mapRuntimeToProvider("claude")).toBe("claude-code");
  });

  it("maps codex to codex", () => {
    expect(mapRuntimeToProvider("codex")).toBe("codex");
  });

  it("throws for gemini", () => {
    expect(() => mapRuntimeToProvider("gemini")).toThrow("not supported");
  });

  it("supportsRuntime returns correct values", () => {
    expect(supportsRuntime("claude")).toBe(true);
    expect(supportsRuntime("codex")).toBe(true);
    expect(supportsRuntime("gemini")).toBe(false);
  });
});
