import WebSocket from "ws";
import type {
  PaseoConnectionState,
  PaseoAgentSnapshot,
  PaseoStreamEvent,
  CreatePaseoAgentOptions,
  Unsubscribe,
} from "./types.js";

export type PaseoDaemonClientOptions = {
  daemonUrl: string;
  apiKey?: string;
  clientId?: string;
  connectTimeoutMs?: number;
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
};

export type PaseoAgentHandle = {
  paseoAgentId: string;
  snapshot: PaseoAgentSnapshot;
};

type StreamCallback = (paseoAgentId: string, event: PaseoStreamEvent) => void;
type StateCallback = (state: PaseoConnectionState) => void;
type AgentUpdateCallback = (agentId: string, snapshot: PaseoAgentSnapshot) => void;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
const RECONNECT_BASE_DELAY_MS = 1500;
const RECONNECT_MAX_DELAY_MS = 30000;
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Thin client for the Paseo Daemon WebSocket protocol.
 *
 * Protocol (JSON-over-WebSocket):
 *   Client → Server: { type: "hello", clientId, protocolVersion: 1 }
 *   Client → Server: { type: "session", message: { type: "...", requestId, ... } }
 *   Server → Client: { type: "session", message: { type: "...", payload: { ... } } }
 *   Server → Client: binary terminal frames (ignored)
 *
 * The "status" message with server info completes the handshake.
 * All request/response messages are correlated via requestId.
 */
export class PaseoDaemonClient {
  private state: PaseoConnectionState = "disconnected";
  private options: PaseoDaemonClientOptions;
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectResolve: ((value: void) => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;

  private streamCallbacks = new Set<StreamCallback>();
  private stateCallbacks = new Set<StateCallback>();
  private agentUpdateCallbacks = new Set<AgentUpdateCallback>();
  private pendingRequests = new Map<string, PendingRequest>();
  private agentStatuses = new Map<string, PaseoAgentSnapshot>();

  private shouldReconnect: boolean;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: PaseoDaemonClientOptions) {
    this.options = options;
    this.shouldReconnect = options.reconnect?.enabled ?? true;
  }

  get connectionState(): PaseoConnectionState {
    return this.state;
  }

  get connected(): boolean {
    return this.state === "connected";
  }

  async connect(): Promise<void> {
    if (this.state === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    this.shouldReconnect = this.options.reconnect?.enabled ?? true;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.attemptConnect();
    });

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnect();
    this.clearConnectTimeout();
    this.rejectAllPending(new Error("Client disconnected"));
    if (this.ws) {
      try {
        this.ws.close(1000, "Client closed");
      } catch {}
      this.ws = null;
    }
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.setState("disconnected");
  }

  async createAgent(options: CreatePaseoAgentOptions): Promise<PaseoAgentHandle> {
    this.requireConnected();
    const requestId = this.createRequestId();
    const config: Record<string, unknown> = {
      provider: options.provider,
      cwd: options.cwd,
    };
    if (options.model) config.model = options.model;
    if (options.systemPrompt) config.systemPrompt = options.systemPrompt;
    if (options.initialPrompt) {
      await this.sendRequest(requestId, "create_agent_request", {
        config,
        initialPrompt: options.initialPrompt,
        ...(options.labels ? { labels: options.labels } : {}),
      });
    } else {
      await this.sendRequest(requestId, "create_agent_request", {
        config,
        ...(options.labels ? { labels: options.labels } : {}),
      });
    }

    const response = await this.waitForRequest(requestId, (msg: Record<string, unknown>) => {
      if (msg.type === "status") {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (payload?.requestId === requestId && payload?.agent) {
          return { kind: "created" as const, agent: payload.agent as Record<string, unknown> };
        }
        if (payload?.requestId === requestId && payload?.status === "agent_create_failed") {
          return { kind: "failed" as const, error: (payload.error as string) ?? "Agent creation failed" };
        }
      }
      return null;
    });

    if (response.kind === "failed") {
      throw new Error(response.error);
    }

    const agent = response.agent;
    const snapshot = this.parseAgentSnapshot(agent);
    this.agentStatuses.set(snapshot.id, snapshot);
    return { paseoAgentId: snapshot.id, snapshot };
  }

  async sendMessage(paseoAgentId: string, text: string): Promise<void> {
    this.requireConnected();
    const requestId = this.createRequestId();
    const messageId = crypto.randomUUID();

    this.sendSessionMessage({
      type: "send_agent_message_request",
      requestId,
      agentId: paseoAgentId,
      text,
      messageId,
    });

    const response = await this.waitForRequest(requestId, (msg: Record<string, unknown>) => {
      if (msg.type === "send_agent_message_response") {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (payload?.requestId === requestId) {
          return { accepted: payload.accepted as boolean, error: payload.error as string | undefined };
        }
      }
      return null;
    });

    if (!response.accepted) {
      throw new Error(response.error ?? "sendMessage rejected");
    }
  }

  async stopAgent(paseoAgentId: string): Promise<void> {
    this.requireConnected();
    const requestId = this.createRequestId();
    this.sendSessionMessage({
      type: "cancel_agent_request",
      requestId,
      agentId: paseoAgentId,
    });
    await this.waitForRequest(requestId, (msg: Record<string, unknown>) => {
      if (msg.type === "cancel_agent_response") {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (payload?.requestId === requestId) return true;
      }
      return null;
    });
  }

  async deleteAgent(paseoAgentId: string): Promise<void> {
    this.requireConnected();
    const requestId = this.createRequestId();
    this.sendSessionMessage({
      type: "delete_agent_request",
      requestId,
      agentId: paseoAgentId,
    });
    await this.waitForRequest(requestId, (msg: Record<string, unknown>) => {
      if (msg.type === "agent_deleted") {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (payload?.requestId === requestId) return true;
      }
      return null;
    });
    this.agentStatuses.delete(paseoAgentId);
  }

  onStreamEvent(callback: StreamCallback): Unsubscribe {
    this.streamCallbacks.add(callback);
    return () => this.streamCallbacks.delete(callback);
  }

  onStateChange(callback: StateCallback): Unsubscribe {
    this.stateCallbacks.add(callback);
    return () => this.stateCallbacks.delete(callback);
  }

  onAgentUpdate(callback: AgentUpdateCallback): Unsubscribe {
    this.agentUpdateCallbacks.add(callback);
    return () => this.agentUpdateCallbacks.delete(callback);
  }

  getAgentSnapshot(paseoAgentId: string): PaseoAgentSnapshot | undefined {
    return this.agentStatuses.get(paseoAgentId);
  }

  // -- private --

  private attemptConnect(): void {
    this.setState("connecting");
    this.clearReconnect();
    this.clearConnectTimeout();

    const headers: Record<string, string> = {};
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }

    try {
      const url = new URL(this.options.daemonUrl);
      if (this.options.apiKey) {
        url.searchParams.set("token", this.options.apiKey);
      }

      this.ws = new WebSocket(url.toString(), {
        headers,
      });
      this.ws.binaryType = "arraybuffer";

      const timeoutMs = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      this.connectTimeout = setTimeout(() => {
        this.lastError("Connection timed out");
        this.cleanupWs();
        this.scheduleReconnect("Connection timed out");
      }, timeoutMs);

      this.ws.on("open", () => {
        this.sendHello();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        this.clearConnectTimeout();
        const msg = reason.toString() || `WebSocket closed (code ${code})`;
        this.lastError(msg);
        this.cleanupWs();
        this.scheduleReconnect(msg);
      });

      this.ws.on("error", (err: Error) => {
        this.clearConnectTimeout();
        this.lastError(err.message);
      });
    } catch (err) {
      this.clearConnectTimeout();
      const message = err instanceof Error ? err.message : "Failed to connect";
      this.lastError(message);
      this.scheduleReconnect(message);
      this.rejectConnect(err instanceof Error ? err : new Error(message));
    }
  }

  private sendHello(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const hello = {
      type: "hello",
      clientId: this.options.clientId ?? `crewden-${crypto.randomUUID().slice(0, 8)}`,
      clientType: "mcp",
      protocolVersion: 1,
    };
    this.ws.send(JSON.stringify(hello));
  }

  private handleMessage(data: WebSocket.Data): void {
    let payload: string;
    if (typeof data === "string") {
      payload = data;
    } else if (Buffer.isBuffer(data)) {
      payload = data.toString("utf8");
    } else if (data instanceof ArrayBuffer) {
      payload = new TextDecoder().decode(data);
    } else if (ArrayBuffer.isView(data)) {
      payload = new TextDecoder().decode(data);
    } else {
      return;
    }

    if (!payload) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }

    if (parsed.type === "pong") return;

    if (parsed.type === "session" && typeof parsed.message === "object" && parsed.message !== null) {
      const msg = parsed.message as Record<string, unknown>;
      this.handleSessionMessage(msg);
    }
  }

  private handleSessionMessage(msg: Record<string, unknown>): void {
    if (msg.type === "status") {
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (payload?.daemonVersion) {
        this.clearConnectTimeout();
        this.reconnectAttempts = 0;
        this.setState("connected");
        this.resolveConnect();
      }
    }

    if (msg.type === "agent_update") {
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (payload?.agent) {
        const snapshot = this.parseAgentSnapshot(payload.agent as Record<string, unknown>);
        this.agentStatuses.set(snapshot.id, snapshot);
        for (const cb of this.agentUpdateCallbacks) {
          try {
            cb(snapshot.id, snapshot);
          } catch {}
        }
      }
    }

    if (msg.type === "agent_stream") {
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (payload?.agentId && payload?.event) {
        const agentId = payload.agentId as string;
        const event = this.parseStreamEvent(payload.event as Record<string, unknown>);
        if (event) {
          for (const cb of this.streamCallbacks) {
            try {
              cb(agentId, event);
            } catch {}
          }
        }
      }
    }

    this.resolvePendingForMessage(msg);
  }

  private sendRequest(requestId: string, type: string, params: Record<string, unknown>): void {
    this.sendSessionMessage({ type, requestId, ...params });
  }

  private sendSessionMessage(message: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`WebSocket not open (readyState=${this.ws?.readyState})`);
    }
    const envelope = { type: "session", message };
    this.ws.send(JSON.stringify(envelope));
  }

  private waitForRequest<T>(
    requestId: string,
    predicate: (msg: Record<string, unknown>) => T | null,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeoutHandle,
        // Store predicate for matching
        ...(process.env.NODE_ENV === "test" ? {} : {}),
      });

      // Check already-buffered messages (no-op for now, messages arrive async)
    });
  }

  private resolvePendingForMessage(msg: Record<string, unknown>): void {
    const payload = msg.payload as Record<string, unknown> | undefined;
    const requestId = (payload?.requestId ?? msg.requestId) as string | undefined;
    if (!requestId) return;

    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    // We don't have the predicate here, so we use a simpler approach:
    // resolve anything that matches the requestId
    clearTimeout(pending.timeoutHandle);
    this.pendingRequests.delete(requestId);

    // For create_agent, we need special handling
    if (msg.type === "status" && payload?.agent && payload?.requestId === requestId) {
      pending.resolve({ kind: "created", agent: payload.agent });
    } else if (msg.type === "status" && payload?.status === "agent_create_failed" && payload?.requestId === requestId) {
      pending.reject(new Error((payload.error as string) ?? "Agent creation failed"));
    } else if (msg.type === "send_agent_message_response" && payload?.requestId === requestId) {
      pending.resolve({ accepted: payload.accepted, error: payload.error });
    } else if (msg.type === "cancel_agent_response" && payload?.requestId === requestId) {
      pending.resolve(true);
    } else if (msg.type === "agent_deleted" && payload?.requestId === requestId) {
      pending.resolve(true);
    } else if (payload?.requestId === requestId) {
      pending.resolve(msg);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private resolveConnect(): void {
    if (this.connectResolve) {
      this.connectResolve();
    }
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  private rejectConnect(error: Error): void {
    if (this.connectReject) {
      this.connectReject(error);
    }
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  private setState(state: PaseoConnectionState): void {
    this.state = state;
    for (const cb of this.stateCallbacks) {
      try {
        cb(state);
      } catch {}
    }
  }

  private lastError(_msg: string): void {
    // Store for diagnostics; could log in debug mode
  }

  private requireConnected(): void {
    if (this.state !== "connected") {
      throw new Error(`PaseoDaemonClient not connected (state: ${this.state})`);
    }
  }

  private scheduleReconnect(_reason: string): void {
    if (!this.shouldReconnect) return;
    if (this.state === "disconnected") return;
    const baseDelay = this.options.reconnect?.baseDelayMs ?? RECONNECT_BASE_DELAY_MS;
    const maxDelay = this.options.reconnect?.maxDelayMs ?? RECONNECT_MAX_DELAY_MS;
    const delay = Math.min(baseDelay * 2 ** this.reconnectAttempts, maxDelay);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connectPromise = null;
      this.connectResolve = null;
      this.connectReject = null;
      this.attemptConnect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  private cleanupWs(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1001, "Reconnecting");
        }
      } catch {}
      this.ws = null;
    }
  }

  private createRequestId(): string {
    return crypto.randomUUID();
  }

  private parseAgentSnapshot(raw: Record<string, unknown>): PaseoAgentSnapshot {
    return {
      id: raw.id as string,
      lifecycle: (raw.lifecycle ?? raw.status ?? "idle") as string,
      provider: (raw.provider as string) ?? "unknown",
      cwd: (raw.cwd as string) ?? "",
      title: raw.title as string | undefined,
      labels: raw.labels as Record<string, string> | undefined,
    };
  }

  private parseStreamEvent(raw: Record<string, unknown>): PaseoStreamEvent | null {
    const type = raw.type as string;
    if (!type) return null;

    return {
      type,
      timestamp: raw.timestamp as string | undefined,
      text: raw.text as string | undefined,
      toolCall: raw.toolCall as { name: string; args?: unknown } | undefined,
      reason: raw.reason as string | undefined,
      error: raw.error as string | undefined,
    };
  }
}
