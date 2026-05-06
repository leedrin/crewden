import { afterEach, describe, expect, it, vi } from "vitest";
import { CrewdenInternalClient, createToolDefinitions } from "../src/mcp-bridge/tools.js";

describe("mcp-bridge tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers 25 crewden tools", () => {
    const tools = createToolDefinitions();
    expect(tools).toHaveLength(25);
    expect(tools.map((tool) => tool.name)).toContain("crewden_send_message");
    expect(tools.map((tool) => tool.name)).toContain("crewden_create_task");
    expect(tools.map((tool) => tool.name)).toContain("crewden_block_task");
    expect(tools.map((tool) => tool.name)).toContain("crewden_invite_agent");
    expect(tools.map((tool) => tool.name)).toContain("crewden_agent_profile");
    expect(tools.map((tool) => tool.name)).toContain("crewden_resolve_agents");
    expect(tools.map((tool) => tool.name)).toContain("crewden_set_reminder");
    expect(tools.map((tool) => tool.name)).toContain("crewden_search_knowledge");
  });

  it("posts message through internal endpoint", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        text: async () => JSON.stringify({ id: "msg-1" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new CrewdenInternalClient({
      baseUrl: "http://127.0.0.1:3000",
      agentId: "agent-1",
      authToken: "token-1",
    });
    const tool = createToolDefinitions().find((entry) => entry.name === "crewden_send_message");
    expect(tool).toBeDefined();

    const result = await tool!.run({ channel: "general", content: "hello" }, { client });
    expect(result).toMatchObject({ id: "msg-1" });

    const [url, request] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:3000/internal/agent/agent-1/messages/send");
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      authorization: "Bearer token-1",
      "x-agent-id": "agent-1",
    });
    expect(request.body).toBe(JSON.stringify({ channel: "general", content: "hello", threadRootId: undefined }));
  });

  it("invites agent by resolve + channel mention", async () => {
    const fetchMock = vi.fn(async (url: URL | string) => {
      if (String(url).includes("/agents/resolve")) {
        return {
          ok: true,
          text: async () => JSON.stringify({ match: { id: "agent-qa", label: "QA" } }),
        } as Response;
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ id: "msg-invite" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new CrewdenInternalClient({
      baseUrl: "http://127.0.0.1:3000",
      agentId: "agent-1",
      authToken: "token-1",
    });
    const tool = createToolDefinitions().find((entry) => entry.name === "crewden_invite_agent");
    expect(tool).toBeDefined();

    const result = await tool!.run({ channel: "general", agent: "qa", note: "need review" }, { client }) as {
      invitedAgentId: string;
      channel: string;
      message: { id: string };
    };

    expect(result.invitedAgentId).toBe("agent-qa");
    expect(result.channel).toBe("general");
    expect(result.message.id).toBe("msg-invite");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resolves agents by role and capabilities", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        text: async () => JSON.stringify([{ agent: { id: "agent-dev" }, score: 100 }]),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new CrewdenInternalClient({
      baseUrl: "http://127.0.0.1:3000",
      agentId: "agent-1",
      authToken: "token-1",
    });
    const tool = createToolDefinitions().find((entry) => entry.name === "crewden_resolve_agents");
    expect(tool).toBeDefined();

    await tool!.run({ role: "developer", capabilities: ["coding", "review"], mustBeIdle: true, maxResults: 2 }, { client });
    const [url] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
    const urlText = String(url);
    expect(urlText).toContain("/internal/agent/agent-1/agents/resolve");
    expect(urlText).toContain("role=developer");
    expect(urlText).toContain("capabilities=coding");
    expect(urlText).toContain("capabilities=review");
    expect(urlText).toContain("mustBeIdle=true");
    expect(urlText).toContain("maxResults=2");
  });
});
