import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { PaseoDaemonClient } from "../src/paseo-daemon-client.js";
import type { PaseoStreamEvent } from "../src/types.js";

function createMockPaseoDaemon(port: number): Promise<{ server: Server; wss: WebSocketServer; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer();
    const wss = new WebSocketServer({ server, path: "/" });

    wss.on("connection", (ws: WebSocket) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "hello") {
          ws.send(JSON.stringify({
            type: "session",
            message: {
              type: "status",
              payload: {
                requestId: "welcome",
                daemonVersion: "0.1.64-test",
                status: "server_info",
              },
            },
          }));
          return;
        }

        if (msg.type === "session") {
          const inner = msg.message;

          if (inner.type === "create_agent_request") {
            ws.send(JSON.stringify({
              type: "session",
              message: {
                type: "status",
                payload: {
                  requestId: inner.requestId,
                  status: "agent_created",
                  agent: {
                    id: "test-agent-" + inner.requestId.slice(0, 8),
                    lifecycle: "initializing",
                    provider: inner.config?.provider ?? "claude",
                    cwd: inner.config?.cwd ?? "/test",
                    title: "Test Agent",
                  },
                },
              },
            }));

            setTimeout(() => {
              ws.send(JSON.stringify({
                type: "session",
                message: {
                  type: "agent_update",
                  payload: {
                    kind: "upsert",
                    agent: {
                      id: "test-agent-" + inner.requestId.slice(0, 8),
                      lifecycle: "running",
                      provider: "claude",
                      cwd: "/test",
                    },
                  },
                },
              }));

              setTimeout(() => {
              ws.send(JSON.stringify({
                type: "session",
                message: {
                  type: "agent_stream",
                  payload: {
                    agentId: "test-agent-" + inner.requestId.slice(0, 8),
                    event: { type: "timeline", item: { type: "assistant_message", text: "PASEO_OK" } },
                  },
                },
              }));

                ws.send(JSON.stringify({
                  type: "session",
                  message: {
                    type: "agent_update",
                    payload: {
                      kind: "upsert",
                      agent: {
                        id: "test-agent-" + inner.requestId.slice(0, 8),
                        lifecycle: "idle",
                        provider: "claude",
                        cwd: "/test",
                      },
                    },
                  },
                }));
              }, 50);
            }, 50);
            return;
          }

          if (inner.type === "send_agent_message_request") {
            ws.send(JSON.stringify({
              type: "session",
              message: {
                type: "send_agent_message_response",
                payload: {
                  requestId: inner.requestId,
                  accepted: true,
                },
              },
            }));
            return;
          }

          if (inner.type === "delete_agent_request") {
            ws.send(JSON.stringify({
              type: "session",
              message: {
                type: "agent_deleted",
                payload: {
                  requestId: inner.requestId,
                  agentId: inner.agentId,
                },
              },
            }));
            return;
          }
        }
      });
    });

    server.listen(port, () => {
      resolve({
        server,
        wss,
        close: () => new Promise((res) => {
          wss.close();
          server.close(() => res());
        }),
      });
    });
  });
}

describe("PaseoDaemonClient integration", () => {
  const port = 18767;
  let mockDaemon: Awaited<ReturnType<typeof createMockPaseoDaemon>>;

  beforeAll(async () => {
    mockDaemon = await createMockPaseoDaemon(port);
  });

  afterAll(async () => {
    await mockDaemon.close();
  });

  it("connects to a mock Paseo daemon", async () => {
    const client = new PaseoDaemonClient({
      daemonUrl: `ws://127.0.0.1:${port}`,
      reconnect: { enabled: false },
    });

    const states: string[] = [];
    client.onStateChange((s) => states.push(s));

    await client.connect();
    expect(client.connected).toBe(true);
    expect(states).toContain("connecting");
    expect(states).toContain("connected");

    await client.disconnect();
  });

  it("creates an agent and receives stream events", async () => {
    const client = new PaseoDaemonClient({
      daemonUrl: `ws://127.0.0.1:${port}`,
      reconnect: { enabled: false },
    });

    await client.connect();

    const streamEvents: Array<{ agentId: string; event: PaseoStreamEvent }> = [];
    client.onStreamEvent((agentId, event) => {
      streamEvents.push({ agentId, event });
    });

    const handle = await client.createAgent({
      provider: "claude",
      cwd: "/test",
      initialPrompt: "Hello",
    });

    expect(handle.paseoAgentId).toBeTruthy();
    expect(handle.snapshot.provider).toBe("claude");

    await new Promise((r) => setTimeout(r, 200));

    expect(streamEvents.length).toBeGreaterThan(0);
    const hasAssistantMessage = streamEvents.some((e) => {
      if (e.event.type === "timeline") {
        const item = e.event.item as { type?: string; text?: string };
        return item.type === "assistant_message" && item.text === "PASEO_OK";
      }
      return false;
    });
    expect(hasAssistantMessage).toBe(true);

    await client.deleteAgent(handle.paseoAgentId);
    await client.disconnect();
  });

  it("sends a message to an agent", async () => {
    const client = new PaseoDaemonClient({
      daemonUrl: `ws://127.0.0.1:${port}`,
      reconnect: { enabled: false },
    });

    await client.connect();
    const handle = await client.createAgent({
      provider: "claude",
      cwd: "/test",
    });

    await client.sendMessage(handle.paseoAgentId, "test message");

    await client.deleteAgent(handle.paseoAgentId);
    await client.disconnect();
  });

  it("receives agent updates", async () => {
    const client = new PaseoDaemonClient({
      daemonUrl: `ws://127.0.0.1:${port}`,
      reconnect: { enabled: false },
    });

    const updates: Array<{ id: string; lifecycle: string }> = [];
    client.onAgentUpdate((id, snapshot) => {
      updates.push({ id, lifecycle: snapshot.lifecycle });
    });

    await client.connect();
    const handle = await client.createAgent({
      provider: "claude",
      cwd: "/test",
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(updates.length).toBeGreaterThan(0);
    expect(updates.some((u) => u.lifecycle === "running")).toBe(true);
    expect(updates.some((u) => u.lifecycle === "idle")).toBe(true);

    await client.deleteAgent(handle.paseoAgentId);
    await client.disconnect();
  });
});
