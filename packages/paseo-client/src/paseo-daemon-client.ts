import type {
  PaseoConnectionState,
  PaseoAgentSnapshot,
  PaseoStreamEvent,
  CreatePaseoAgentOptions,
  McpServerConfig,
  Unsubscribe,
} from "./types.js";

export type PaseoDaemonClientOptions = {
  daemonUrl: string;
  apiKey: string;
};

export type PaseoAgentHandle = {
  paseoAgentId: string;
  snapshot: PaseoAgentSnapshot;
};

type StreamCallback = (paseoAgentId: string, event: PaseoStreamEvent) => void;
type StateCallback = (state: PaseoConnectionState) => void;

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

export class PaseoDaemonClient {
  private state: PaseoConnectionState = "disconnected";
  private options: PaseoDaemonClientOptions;
  private streamCallbacks = new Set<StreamCallback>();
  private stateCallbacks = new Set<StateCallback>();
  private reconnectAttempts = 0;
  private shouldReconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // TODO: Phase 0 — Replace with real Paseo client SDK transport.
  //       This skeleton uses a placeholder transport interface.
  //       The real implementation will import from @getpaseo/client-sdk
  //       and handle binary multiplexed WebSocket protocol.
  private transport: unknown = null;

  constructor(options: PaseoDaemonClientOptions) {
    this.options = options;
  }

  get connectionState(): PaseoConnectionState {
    return this.state;
  }

  get connected(): boolean {
    return this.state === "connected";
  }

  async connect(): Promise<void> {
    if (this.state === "connected") return;

    this.setState("connecting");
    this.shouldReconnect = true;

    try {
      // TODO: Phase 0 — Implement real connection via Paseo client SDK.
      // const transportFactory = createWebSocketTransportFactory(this.options.daemonUrl, {
      //   headers: { Authorization: `Bearer ${this.options.apiKey}` },
      // });
      // this.transport = new DaemonClient({ transportFactory });
      // await this.transport.connect();

      this.setState("connected");
      this.reconnectAttempts = 0;
    } catch (err) {
      this.setState("error");
      this.scheduleReconnect();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // TODO: await this.transport?.disconnect();
    this.transport = null;
    this.setState("disconnected");
  }

  async createAgent(options: CreatePaseoAgentOptions): Promise<PaseoAgentHandle> {
    this.requireConnected();

    // TODO: Phase 0 — Delegate to real SDK.
    // const snapshot = await this.transport.createAgent({
    //   provider: options.provider,
    //   cwd: options.cwd,
    //   model: options.model,
    //   systemPrompt: options.systemPrompt,
    //   initialPrompt: options.initialPrompt,
    //   mcpServers: options.mcpServers,
    //   labels: options.labels,
    // });
    // return { paseoAgentId: snapshot.id, snapshot };

    throw new Error("PaseoDaemonClient.createAgent not implemented — requires Phase 0 SDK");
  }

  async sendMessage(paseoAgentId: string, text: string): Promise<void> {
    this.requireConnected();

    // TODO: Phase 0 — Delegate to real SDK.
    // await this.transport.sendMessage(paseoAgentId, text);

    throw new Error("PaseoDaemonClient.sendMessage not implemented — requires Phase 0 SDK");
  }

  async stopAgent(paseoAgentId: string): Promise<void> {
    this.requireConnected();

    // TODO: Phase 0
    // await this.transport.cancelAgent(paseoAgentId);

    throw new Error("PaseoDaemonClient.stopAgent not implemented — requires Phase 0 SDK");
  }

  async deleteAgent(paseoAgentId: string): Promise<void> {
    this.requireConnected();

    // TODO: Phase 0
    // await this.transport.deleteAgent(paseoAgentId);

    throw new Error("PaseoDaemonClient.deleteAgent not implemented — requires Phase 0 SDK");
  }

  async inspectAgent(paseoAgentId: string): Promise<PaseoAgentSnapshot> {
    this.requireConnected();

    // TODO: Phase 0

    throw new Error("PaseoDaemonClient.inspectAgent not implemented — requires Phase 0 SDK");
  }

  onStreamEvent(callback: StreamCallback): Unsubscribe {
    this.streamCallbacks.add(callback);
    return () => this.streamCallbacks.delete(callback);
  }

  onStateChange(callback: StateCallback): Unsubscribe {
    this.stateCallbacks.add(callback);
    return () => this.stateCallbacks.delete(callback);
  }

  private setState(state: PaseoConnectionState): void {
    this.state = state;
    for (const cb of this.stateCallbacks) {
      try {
        cb(state);
      } catch {}
    }
  }

  private requireConnected(): void {
    if (this.state !== "connected") {
      throw new Error(`PaseoDaemonClient not connected (state: ${this.state})`);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  private emitStreamEvent(paseoAgentId: string, event: PaseoStreamEvent): void {
    for (const cb of this.streamCallbacks) {
      try {
        cb(paseoAgentId, event);
      } catch {}
    }
  }
}
