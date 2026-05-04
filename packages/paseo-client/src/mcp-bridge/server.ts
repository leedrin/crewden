import { createToolDefinitions, type CrewdenInternalClient, type ToolDefinition } from "./tools.js";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const SUPPORTED_PROTOCOL_VERSION = "2025-06-18";

export class CrewdenMcpServer {
  private readonly tools: ToolDefinition[];
  private readonly toolsByName: Map<string, ToolDefinition>;
  private readonly toolContext: { client: CrewdenInternalClient };
  private buffer = Buffer.alloc(0);

  constructor(client: CrewdenInternalClient) {
    this.tools = createToolDefinitions();
    this.toolsByName = new Map(this.tools.map((tool) => [tool.name, tool]));
    this.toolContext = { client };
  }

  start(): void {
    process.stdin.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainBuffer();
    });
    process.stdin.on("error", (error) => {
      console.error("[crewden-mcp] stdin error", error);
    });
    process.stdout.on("error", (error) => {
      console.error("[crewden-mcp] stdout error", error);
    });
  }

  private drainBuffer(): void {
    while (true) {
      const frame = this.tryReadFrame();
      if (!frame) return;
      void this.handleFrame(frame);
    }
  }

  private tryReadFrame(): string | null {
    const separator = this.buffer.indexOf("\r\n\r\n");
    if (separator < 0) return null;

    const headerText = this.buffer.subarray(0, separator).toString("utf8");
    const headers = parseHeaders(headerText);
    const contentLength = Number(headers["content-length"]);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      this.buffer = this.buffer.subarray(separator + 4);
      return null;
    }

    const totalLength = separator + 4 + contentLength;
    if (this.buffer.length < totalLength) return null;

    const body = this.buffer.subarray(separator + 4, totalLength).toString("utf8");
    this.buffer = this.buffer.subarray(totalLength);
    return body;
  }

  private async handleFrame(frame: string): Promise<void> {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(frame) as JsonRpcRequest;
    } catch {
      this.writeError(null, -32700, "Parse error");
      return;
    }

    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      this.writeError(request.id ?? null, -32600, "Invalid Request");
      return;
    }

    if (request.id === undefined || request.id === null) {
      if (request.method === "notifications/initialized") return;
      return;
    }

    try {
      const result = await this.dispatch(request.method, request.params ?? {});
      this.write({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      this.writeError(
        request.id,
        -32000,
        error instanceof Error ? error.message : "Tool execution failed",
      );
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: SUPPORTED_PROTOCOL_VERSION,
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: "crewden-mcp-bridge",
            version: "0.1.0",
          },
        };

      case "tools/list":
        return {
          tools: this.tools.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        };

      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const tool = this.toolsByName.get(name);
        if (!tool) {
          throw new Error(`Unknown tool: ${name}`);
        }

        const args = asRecord(params.arguments) ?? {};
        try {
          const value = await tool.run(args, this.toolContext);
          return {
            content: [
              {
                type: "text",
                text: renderContentText(value),
              },
            ],
            structuredContent: {
              ok: true,
              tool: tool.name,
              data: value,
            },
            isError: false,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool execution failed";
          return {
            content: [
              {
                type: "text",
                text: `Error: ${message}`,
              },
            ],
            structuredContent: {
              ok: false,
              tool: tool.name,
              error: message,
            },
            isError: true,
          };
        }
      }

      default:
        throw new Error(`Method not supported: ${method}`);
    }
  }

  private writeError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        data,
      },
    };
    this.write(response);
  }

  private write(response: JsonRpcResponse): void {
    const json = JSON.stringify(response);
    const content = Buffer.from(json, "utf8");
    const header = Buffer.from(`Content-Length: ${content.length}\r\n\r\n`, "utf8");
    process.stdout.write(Buffer.concat([header, content]));
  }
}

function parseHeaders(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of headerText.split("\r\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    headers[key] = value;
  }
  return headers;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function renderContentText(value: unknown): string {
  if (value === undefined) return "ok";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
