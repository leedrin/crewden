# Paseo × Crewden 整合详细功能设计方案

> 基于 CREWDEN_INTEGRATION.md 方案的可行性评审结果，修订后的详细设计。
> 评审结论：方向正确，但协议适配复杂度和工作量被低估。本方案增加 Phase 0 概念验证，调整分阶段策略，细化技术设计。

---

## 一、整合策略

### 1.1 核心原则

1. **Paseo 管生命周期，Crewden 管协作** — Paseo Daemon 负责 Agent 进程的创建、启动、停止、monitoring；Crewden Server 负责 Channel/Message/Task/Goal/Review/Knowledge 协作逻辑
2. **渐进替换，共存过渡** — 不一步删除 `packages/daemon`，先让 Paseo 作为可选后端与现有 daemon 共存，验证通过后再移除
3. **基于 Paseo 客户端 SDK** — `PaseoDaemonClient` 基于现有 `packages/server/src/client/daemon-client.ts` 的协议实现，不从零编写
4. **保留现有 MCP 桥接** — 不急于用 ACP 工具替换现有 MCP bridge + stdout bridge，先对齐再扩展

### 1.2 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser / Mobile (Crewden Web UI)              │
│              Channel / DM / Task / Goal / Review / Knowledge    │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HTTP REST + WebSocket (/ws)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Crewden Server（改造后）                          │
│                                                                 │
│  REST API: Channel / Message / Task / Goal / Review / Knowledge │
│  WebSocket Hub: Browser ←→ Server 协作状态推送                   │
│  Internal Agent API: Agent HTTP 端点（保留不变）                  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ AgentRuntimeBridge（新增，统一抽象层）                       │  │
│  │                                                           │  │
│  │  ┌─────────────────┐    ┌────────────────────────────┐   │  │
│  │  │ LocalDaemonMode  │    │ PaseoDaemonMode（新增）     │   │  │
│  │  │ (现有 daemon)    │    │ - PaseoDaemonClient        │   │  │
│  │  │                 │    │ - InboxAdapter              │   │  │
│  │  │ daemonRegistry  │    │ - TimelineToEventBridge     │   │  │
│  │  │ daemonSocket    │    │ - CrewdenContextInjector     │   │  │
│  │  └─────────────────┘    └────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└───────────────────────┬─────────────────────────────────────────┘
                        │                        │
         (LocalDaemonMode)   (PaseoDaemonMode)
          WebSocket                WebSocket
          /daemon/connect          Paseo 二进制协议
               │                        │
               ▼                        ▼
┌──────────────────────┐    ┌──────────────────────────────────────┐
│  Crewden Daemon      │    │  Paseo Daemon (Node.js)              │
│  (packages/daemon)   │    │  AgentManager · Providers · Timeline │
│  AgentProcessManager │    │  MCP Server · Session Persistence    │
│  Runtime Drivers     │    └──────────┬───────────────────────────┘
└──────────┬───────────┘               │ ACP / SDK
           │ spawn                      ▼
           ▼                ┌──────────────────────────────────────┐
┌──────────────────────┐    │  CLI Agents: claude | codex | opencode│
│  CLI Agents          │    └──────────────────────────────────────┘
│  claude|codex|gemini │
└──────────────────────┘
```

**关键变化（相对原方案）：**

- 不直接删除 `packages/daemon`，而是引入 `AgentRuntimeBridge` 抽象层，支持两种后端模式
- `PaseoDaemonMode` 是新增后端，与现有 `LocalDaemonMode` 并行
- Agent 的 Crewden 协作上下文（channel、task、inbox summary）通过 `CrewdenContextInjector` 注入

---

## 二、核心模块设计

### 2.1 AgentRuntimeBridge（统一抽象层）

定义 Crewden Server 与 Agent 运行时交互的统一接口，屏蔽底层差异。

```typescript
// packages/server/src/agent-runtime-bridge/types.ts

export interface AgentRuntimeBridge {
  readonly mode: "local-daemon" | "paseo-daemon";

  /** 连接到运行时后端 */
  connect(): Promise<void>;

  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 连接状态 */
  readonly connected: boolean;

  /** 启动 Agent */
  startAgent(params: StartAgentParams): Promise<StartAgentResult>;

  /** 停止 Agent */
  stopAgent(agentId: string): Promise<void>;

  /** 向 Agent 投递消息 */
  deliverMessage(params: DeliverMessageParams): Promise<void>;

  /** 读取 Agent 工作区文件 */
  readWorkspace(agentId: string, relPath: string): Promise<WorkspaceEntry | WorkspaceError>;

  /** 列出可用 Runtime */
  listRuntimes(): RuntimeInfo[];

  /** 订阅 Agent 状态变化 */
  onAgentStatusChange(callback: (agentId: string, status: AgentStatus) => void): Unsubscribe;

  /** 订阅 Agent 消息输出 */
  onAgentMessage(callback: (event: AgentMessageEvent) => void): Unsubscribe;

  /** 订阅 Agent 活动事件 */
  onAgentActivity(callback: (event: AgentActivityEvent) => void): Unsubscribe;
}

export interface StartAgentParams {
  agentId: string;
  config: AgentRuntimeConfig;
  channelId: string;
  wakeMessage?: AgentDelivery;
  inboxSummary?: string;
}

export interface StartAgentResult {
  launchId: string;
}

export interface DeliverMessageParams {
  agentId: string;
  delivery: AgentDelivery;
  config?: AgentRuntimeConfig;
  channelId?: string;
  inboxSummary?: string;
}

export interface AgentMessageEvent {
  agentId: string;
  channelId: string;
  content: string;
  inReplyToMessageId?: string;
}

export interface AgentActivityEvent {
  agentId: string;
  type: "thinking" | "working" | "output" | "idle" | "sending" | "error";
  detail?: string;
}

export interface RuntimeInfo {
  id: string;
  version: string;
}

export type Unsubscribe = () => void;
```

**现有代码映射到接口：**

| `AgentRuntimeBridge` 方法 | `LocalDaemonMode` 对应实现                                       |
| ------------------------- | ---------------------------------------------------------------- |
| `startAgent`              | `daemonRegistry.send(machineId, { type: 'agent:start', ... })`   |
| `stopAgent`               | `daemonRegistry.send(machineId, { type: 'agent:stop', ... })`    |
| `deliverMessage`          | `daemonRegistry.send(machineId, { type: 'agent:deliver', ... })` |
| `readWorkspace`           | `daemonRegistry.readWorkspace(machineId, ...)`                   |
| `onAgentStatusChange`     | 监听 `ws/daemonSocket.ts` 中 `agent:status` 消息                 |
| `onAgentMessage`          | 监听 `ws/daemonSocket.ts` 中 `agent:message` 消息                |

### 2.2 LocalDaemonMode（现有 daemon 的桥接适配）

将现有 `daemonRegistry` + `daemonSocket.ts` 的逻辑封装为 `AgentRuntimeBridge` 实现。不改变现有行为，仅增加抽象层。

```typescript
// packages/server/src/agent-runtime-bridge/local-daemon-mode.ts

export class LocalDaemonMode implements AgentRuntimeBridge {
  readonly mode = "local-daemon" as const;

  // 内部持有 daemonRegistry 实例
  // 将 daemonSocket.ts 中的消息处理逻辑重定向到 callback
  // startAgent → daemonRegistry.send(machineId, { type: 'agent:start', ... })
  // deliverMessage → daemonRegistry.send(machineId, { type: 'agent:deliver', ... })
  // onAgentMessage → 注册到 daemonSocket 消息分发器
}
```

**改造范围：**

- `daemonSocket.ts`：消息处理逻辑提取为事件发射器，由 `LocalDaemonMode` 订阅
- `daemonRegistry.ts`：保持不变，作为底层传输
- `routes/agents.ts`、`routes/messages.ts`：将 `daemonRegistry.send(...)` 调用替换为 `bridge.deliverMessage(...)`
- `delegation.ts`、`taskDelivery.ts`：同上

### 2.3 PaseoDaemonMode（Paseo 后端）

#### 2.3.1 PaseoDaemonClient

基于 Paseo 现有客户端协议栈连接 Paseo Daemon。

```typescript
// packages/paseo-client/src/paseo-daemon-client.ts

export class PaseoDaemonClient {
  private client: DaemonClient | null = null;
  private subscribers: {
    status: Set<(agentId: string, status: string) => void>;
    stream: Set<(agentId: string, event: AgentStreamEvent) => void>;
  } = new DefaultMap(() => new Set());

  /**
   * 连接到 Paseo Daemon。
   *
   * 协议：Paseo 二进制多路复用 WebSocket
   * 握手：WSHelloMessage → WSWelcomeMessage
   * 消息：SessionInboundMessage / SessionOutboundMessage
   */
  async connect(daemonUrl: string, apiKey: string): Promise<void>;

  /** 创建 Paseo Agent，返回 agentId */
  async createAgent(options: {
    provider: string; // "claude" | "codex" | "opencode"
    cwd: string;
    model?: string;
    systemPrompt?: string;
    initialPrompt?: string;
    mcpServers?: Record<string, McpServerConfig>;
    labels?: Record<string, string>;
  }): Promise<AgentSnapshotPayload>;

  /** 向 Agent 发送消息 */
  async sendMessage(agentId: string, text: string): Promise<void>;

  /** 停止 Agent */
  async stopAgent(agentId: string): Promise<void>;

  /** 删除 Agent */
  async deleteAgent(agentId: string): Promise<void>;

  /** 获取 Agent 快照 */
  async inspectAgent(agentId: string): Promise<AgentSnapshotPayload>;

  /** 获取 Agent Timeline */
  async fetchTimeline(
    agentId: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<AgentTimelineFetchResult>;

  /** 订阅 Agent stream 事件 */
  subscribeToAgent(agentId: string, callback: (event: AgentStreamEvent) => void): Unsubscribe;

  /** 断开连接 */
  async disconnect(): Promise<void>;
}
```

**实现策略：**

不抽取 Paseo 客户端协议代码为独立 SDK（`@getpaseo/client-sdk` 不存在且抽取成本高），而是在 Crewden 的 `packages/paseo-client/` 中直接实现轻量级 Paseo 协议客户端，通过 `ws` 库连接 Paseo Daemon，自行处理 JSON-over-WebSocket 协议（hello 握手、session 消息封套、requestId 关联）。

> **已验证**：Phase 0 已实现此方案，15+ 测试通过（含 mock daemon 集成测试）。无需 `@getpaseo/client-sdk` 前置依赖。

SDK 内部处理：

1. WebSocket 连接管理（含重连）
2. 二进制多路复用编解码
3. Hello/Welcome 握手
4. 请求-响应关联（requestId 匹配）
5. Timeline 订阅与事件分发

```typescript
// packages/paseo-client/src/paseo-daemon-client.ts
// 轻量级实现，直接通过 ws 库连接 Paseo Daemon
// 无需 @getpaseo/client-sdk 依赖

import WebSocket from "ws";
// ... 自行实现 JSON-over-WebSocket 协议

export class PaseoDaemonClient {
  // 连接、hello 握手、session 消息收发
  // 详见 packages/paseo-client/src/paseo-daemon-client.ts（Phase 0 已实现）
}
```

#### 2.3.2 InboxAdapter

将 Crewden 的 inbox 队列语义适配到 Paseo 的 turn-based 模型。

```typescript
// packages/paseo-client/src/inbox-adapter.ts

/**
 * Crewden Agent 有 inbox 队列：
 * - 多条消息排队，agent 处理完一条自动取下一条
 * - agent 空闲时消息入队，不立即启动新进程
 *
 * Paseo Agent 是 turn-based：
 * - sendMessage 发送一条消息，agent 处理完进入 idle
 * - 没有"排队"概念
 *
 * InboxAdapter 在内存中维护 inbox 队列，
 * 每次 agent idle 时取下一条投递。
 */
export class InboxAdapter {
  private queues = new Map<string, QueuedMessage[]>();
  private processing = new Map<string, boolean>();

  /**
   * 入队消息。如果 agent 空闲，立即投递。
   */
  async enqueue(
    agentId: string,
    delivery: AgentDelivery,
    send: (agentId: string, text: string) => Promise<void>,
  ): Promise<void> {
    const queue = this.getOrCreateQueue(agentId);
    queue.push(delivery);
    await this.tryDeliverNext(agentId, send);
  }

  /**
   * Agent idle 回调。尝试投递下一条。
   */
  async onAgentIdle(
    agentId: string,
    send: (agentId: string, text: string) => Promise<void>,
  ): Promise<void> {
    this.processing.set(agentId, false);
    await this.tryDeliverNext(agentId, send);
  }

  private async tryDeliverNext(
    agentId: string,
    send: (agentId: string, text: string) => Promise<void>,
  ): Promise<void> {
    if (this.processing.get(agentId)) return;
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) return;

    this.processing.set(agentId, true);
    const delivery = queue.shift()!;
    try {
      await send(agentId, delivery.content);
    } catch (err) {
      // 投递失败，重新入队到队首
      queue.unshift(delivery);
      this.processing.set(agentId, false);
      throw err;
    }
  }
}
```

#### 2.3.3 TimelineToEventBridge

将 Paseo AgentStreamEvent 转换为 Crewden 的 `AgentMessageEvent` / `AgentActivityEvent`。

Paseo 的 `agent_stream` 事件类型（`AgentStreamEventPayloadSchema`）：

- `thread_started` / `turn_started` / `turn_completed` / `turn_failed` / `turn_canceled` — turn 生命周期
- `timeline` — 含 `item` 字段，item 类型：`user_message`, `assistant_message`, `reasoning`, `tool_call`, `todo`, `error`, `compaction`
- `permission_requested` / `permission_resolved` — 权限审批
- `attention_required` — 需要用户关注

```typescript
// packages/paseo-client/src/timeline-to-event-bridge.ts

export class TimelineToEventBridge {
  /**
   * Paseo AgentStreamEvent → Crewden AgentMessageEvent / AgentActivityEvent
   *
   * 关键映射：
   * - Paseo "timeline" item.type="assistant_message" → Crewden agent:message（累积完整回复）
   * - Paseo "timeline" item.type="reasoning" → Crewden agent:activity(thinking)
   * - Paseo "timeline" item.type="tool_call" → Crewden agent:activity（检测 crewden_* 工具）
   * - Paseo "turn_completed" → Crewden agent:status=idle + flush + inbox 投递
   * - Paseo "turn_failed" → Crewden agent:status=error
   */
  mapStreamEvent(event: PaseoStreamEvent, agentId: string, channelId: string): CrewdenEvent | null {
    switch (event.type) {
      case "timeline": {
        const item = event.item;
        if (!item) return null;

        switch (item.type) {
          case "assistant_message":
            return { type: "agent:message", agentId, channelId, content: item.text ?? "" };

          case "reasoning":
            return { type: "agent:activity", agentId, activityType: "thinking", detail: item.text };

          case "tool_call": {
            const toolName = item.toolName ?? "";
            if (isCrewdenTool(toolName)) {
              return { type: "crewden:tool_call", agentId, toolName, args: item.args };
            }
            return {
              type: "agent:activity",
              agentId,
              activityType: "working",
              detail: `tool:${toolName}`,
            };
          }

          case "error":
            return { type: "agent:activity", agentId, activityType: "error", detail: item.message };

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

      default:
        return null;
    }
  }
}
```

#### 2.3.4 CrewdenContextInjector

将 Crewden 的协作上下文注入 Paseo Agent 的消息和 system prompt。

```typescript
// packages/paseo-client/src/crewden-context-injector.ts

export class CrewdenContextInjector {
  /**
   * 构建投递给 Agent 的完整消息。
   *
   * 在 Paseo 模式下，Agent 不再读取 Crewden 的 stdout bridge 指令，
   * 而是通过 MCP 工具直接调用 Crewden Server API。
   *
   * 消息格式：
   * [inbox summary]
   * [delivery content]
   * [context blocks: channel, task, goal, thread]
   */
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

  /**
   * 构建 Crewden MCP 工具注入配置。
   *
   * 注入为 Paseo Agent 的 MCP Server，这样 Agent 可以
   * 通过标准 MCP 协议调用 Crewden 协作工具。
   */
  buildMcpConfig(params: {
    agentId: string;
    serverUrl: string;
    agentToken: string;
  }): Record<string, McpServerConfig> {
    return {
      crewden: {
        type: "stdio" as const,
        command: "node",
        args: [
          join(__dirname, "../mcp-bridge/bin.js"),
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

  /**
   * 构建 system prompt 附加内容。
   *
   * 复用现有 bridge/simpleToolBridge.ts 中的 buildBridgeInstruction()，
   * 但改为 MCP 优先指令。
   */
  buildSystemPromptAppendix(): string {
    return [
      "You have access to crewden collaboration tools via MCP.",
      "Use MCP tools for message sending, DMs, delegation, task management, and knowledge.",
      "Prefer MCP tools over CLI commands when available.",
      "Use `crewden message check` or read inbox to check for queued messages.",
      // ... 复用现有指令
    ].join("\n");
  }
}
```

#### 2.3.5 PaseoDaemonMode（完整实现）

```typescript
// packages/server/src/agent-runtime-bridge/paseo-daemon-mode.ts

export class PaseoDaemonMode implements AgentRuntimeBridge {
  readonly mode = "paseo-daemon" as const;

  private paseoClient: PaseoDaemonClient;
  private inboxAdapter: InboxAdapter;
  private timelineBridge: TimelineToEventBridge;
  private contextInjector: CrewdenContextInjector;

  // agentId 映射：Crewden agent ID ↔ Paseo agent ID
  private crewdenToPaseo = new Map<string, string>();
  private paseoToCrewden = new Map<string, string>();

  // channel 绑定：agentId → channelId
  private agentChannels = new Map<string, string>();

  private statusCallbacks = new Set<...>();
  private messageCallbacks = new Set<...>();
  private activityCallbacks = new Set<...>();

  async connect(): Promise<void> {
    await this.paseoClient.connect(this.daemonUrl, this.apiKey);
    this.subscribeToTimeline();
  }

  async startAgent(params: StartAgentParams): Promise<StartAgentResult> {
    // 1. 获取 agent token
    const token = await getStore().getOrCreateAgentToken(params.agentId);

    // 2. 构建 MCP 配置（注入 Crewden 协作工具）
    const mcpServers = this.contextInjector.buildMcpConfig({
      agentId: params.agentId,
      serverUrl: this.serverUrl,
      agentToken: token.token,
    });

    // 3. 构建 system prompt 附加内容
    const systemPrompt = [
      params.config.systemPrompt ?? "",
      this.contextInjector.buildSystemPromptAppendix(),
    ].filter(Boolean).join("\n\n");

    // 4. 构建 initial prompt
    const initialPrompt = params.wakeMessage
      ? this.contextInjector.buildDeliverPrompt({
          delivery: params.wakeMessage,
          inboxSummary: params.inboxSummary,
          agentId: params.agentId,
          channelId: params.channelId,
        })
      : undefined;

    // 5. 创建 Paseo Agent
    const paseoAgent = await this.paseoClient.createAgent({
      provider: mapRuntimeToProvider(params.config.runtime),
      cwd: this.getWorkspaceDir(params.agentId),
      model: params.config.model,
      systemPrompt,
      initialPrompt,
      mcpServers,
      labels: {
        source: "crewden",
        "crewden.agent-id": params.agentId,
        "crewden.channel-id": params.channelId,
      },
    });

    // 6. 记录映射
    this.crewdenToPaseo.set(params.agentId, paseoAgent.id);
    this.paseoToCrewden.set(paseoAgent.id, params.agentId);
    this.agentChannels.set(params.agentId, params.channelId);

    return { launchId: paseoAgent.id };
  }

  async deliverMessage(params: DeliverMessageParams): Promise<void> {
    const paseoAgentId = this.crewdenToPaseo.get(params.agentId);
    if (!paseoAgentId) throw new Error(`Agent ${params.agentId} not started`);

    const text = this.contextInjector.buildDeliverPrompt({
      delivery: params.delivery,
      inboxSummary: params.inboxSummary,
      agentId: params.agentId,
      channelId: params.agentChannels.get(params.agentId) ?? params.channelId ?? "general",
    });

    await this.inboxAdapter.enqueue(params.agentId, params.delivery, async (_, content) => {
      await this.paseoClient.sendMessage(paseoAgentId, content);
    });
  }

  async stopAgent(agentId: string): Promise<void> {
    const paseoAgentId = this.crewdenToPaseo.get(agentId);
    if (!paseoAgentId) return;
    await this.paseoClient.stopAgent(paseoAgentId);
    this.cleanupMapping(agentId);
  }

  private subscribeToTimeline(): void {
    // 监听 Paseo stream 事件
    this.paseoClient.onStreamEvent((paseoAgentId, event) => {
      const crewdenAgentId = this.paseoToCrewden.get(paseoAgentId);
      if (!crewdenAgentId) return;

      const mapped = this.timelineBridge.mapStreamEvent(
        event,
        crewdenAgentId,
        this.agentChannels.get(crewdenAgentId) ?? "general",
      );
      if (!mapped) return;

      if (mapped.type === "agent:message") {
        for (const cb of this.messageCallbacks) {
          cb(mapped);
        }
      } else if (mapped.type === "agent:status") {
        if (mapped.status === "idle") {
          this.inboxAdapter.onAgentIdle(crewdenAgentId, async (id, text) => {
            const pid = this.crewdenToPaseo.get(id);
            if (pid) await this.paseoClient.sendMessage(pid, text);
          });
        }
        for (const cb of this.statusCallbacks) {
          cb(crewdenAgentId, mapped.status);
        }
      } else if (mapped.type === "crewden:tool_call") {
        this.handleCrewdenToolCall(crewdenAgentId, mapped);
      }
    });
  }

  /**
   * 处理 crewden_* MCP 工具调用。
   *
   * 在 Paseo 模式下，Agent 通过 MCP 直接调用 Crewden Server API，
   * 不经过 stdout bridge。MCP bridge（stdio 进程）内部通过 HTTP 调用
   * Internal Agent API。
   *
   * 此方法用于监听工具调用事件，同步更新 Crewden 的 activity log。
   */
  private handleCrewdenToolCall(
    crewdenAgentId: string,
    event: { toolName: string; args?: unknown },
  ): void {
    for (const cb of this.activityCallbacks) {
      cb({
        agentId: crewdenAgentId,
        type: "sending",
        detail: `mcp:${event.toolName}`,
      });
    }
  }
}
```

### 2.4 Runtime 映射

Crewden 的 `RuntimeId` 与 Paseo 的 `AgentProvider` 映射：

| Crewden RuntimeId | Paseo Provider | 说明                        |
| ----------------- | -------------- | --------------------------- |
| `claude`          | `claude`       | Claude Code CLI             |
| `codex`           | `codex`        | Codex CLI                   |
| `gemini`          | 暂不支持       | Paseo 目前不支持 Gemini CLI |

**Gemini 处理策略**：Phase 0-2 不支持 Gemini runtime。如果用户在 Crewden 中选择 Gemini，提示"Paseo 模式暂不支持 Gemini runtime，请使用 Local Daemon 模式"。

```typescript
function mapRuntimeToProvider(runtime: RuntimeId): string {
  switch (runtime) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      throw new Error("Gemini runtime not supported in Paseo mode");
  }
}
```

### 2.5 MCP Bridge 迁移

现有 `packages/daemon/src/mcp/bridge.ts` 是一个 JSON-RPC MCP Server，通过 stdio 与 Agent 进程通信，内部转发到 Crewden Server 的 Internal Agent API。

**迁移策略**：将 MCP bridge 提取为独立可执行文件，作为 MCP Server 注入到 Paseo Agent 配置中。

```
packages/paseo-client/src/mcp-bridge/
  index.ts              ← 入口，解析 CLI 参数
  server.ts             ← MCP Server 主逻辑（复用现有 mcp/bridge.ts）
  tools.ts              ← 工具定义（扩展现有 12 个到 22 个）
```

**工具映射**：

| Phase                     | 工具名               | 对应 Internal API                                       |
| ------------------------- | -------------------- | ------------------------------------------------------- |
| **Phase 2（核心 12 个）** |                      |                                                         |
|                           | `send_message`       | `POST /internal/agent/:id/messages/send`                |
|                           | `check_messages`     | `GET /internal/agent/:id/messages/check`                |
|                           | `read_history`       | `GET /internal/agent/:id/messages/read`                 |
|                           | `send_dm`            | `POST /internal/agent/:id/dms/send`                     |
|                           | `delegate_agent`     | `POST /internal/agent/:id/delegate`                     |
|                           | `list_agents`        | `GET /internal/agent/:id/server/info` (select agents)   |
|                           | `server_info`        | `GET /internal/agent/:id/server/info`                   |
|                           | `list_tasks`         | `GET /internal/agent/:id/tasks`                         |
|                           | `update_task_status` | `POST /internal/agent/:id/tasks/:taskId/update`         |
|                           | `schedule_reminder`  | `POST /internal/agent/:id/reminders`                    |
|                           | `list_reminders`     | `GET /internal/agent/:id/reminders`                     |
|                           | `cancel_reminder`    | `POST /internal/agent/:id/reminders/:reminderId/cancel` |
| **Phase 3（扩展 10 个）** |                      |                                                         |
|                           | `claim_task`         | `POST /internal/agent/:id/tasks/:taskId/claim`          |
|                           | `read_task`          | `GET /internal/agent/:id/tasks/:taskId`                 |
|                           | `handoff_task`       | `POST /internal/agent/:id/tasks/:taskId/handoff`        |
|                           | `block_task`         | `POST /internal/agent/:id/tasks/:taskId/block`          |
|                           | `escalate_task`      | `POST /internal/agent/:id/tasks/:taskId/escalate`       |
|                           | `progress_task`      | `POST /internal/agent/:id/tasks/:taskId/progress`       |
|                           | `search_knowledge`   | `GET /internal/agent/:id/knowledge`                     |
|                           | `write_knowledge`    | `POST /internal/agent/:id/knowledge`                    |
|                           | `list_goals`         | `GET /internal/agent/:id/goals`                         |
|                           | `review_request`     | `POST /internal/agent/:id/tasks/:taskId/reviews`        |

---

## 三、Server 端改造清单

### 3.1 新增文件

```
packages/server/src/
  agent-runtime-bridge/
    types.ts                     ← AgentRuntimeBridge 接口定义
    local-daemon-mode.ts         ← 现有 daemon 的桥接封装
    paseo-daemon-mode.ts         ← Paseo 后端实现
    bridge-factory.ts            ← 根据 mode 创建对应 bridge

packages/paseo-client/           ← 新增 npm 包
  src/
    index.ts                     ← 包入口
    paseo-daemon-client.ts       ← Paseo 连接管理
    inbox-adapter.ts             ← inbox 队列适配
    timeline-to-event-bridge.ts  ← Timeline → Crewden 事件映射
    crewden-context-injector.ts  ← 协作上下文注入
    runtime-mapper.ts            ← Runtime 映射
    mcp-bridge/
      index.ts                   ← MCP Server 入口
      server.ts                  ← MCP JSON-RPC 处理
      tools.ts                   ← 工具定义与映射
    types.ts                     ← 共享类型
  package.json
  tsconfig.json
```

### 3.2 改造文件

```
packages/server/src/
  ws/daemonSocket.ts          ← 消息处理提取为事件发射器，由 LocalDaemonMode 订阅
  routes/agents.ts            ← daemonRegistry.send → bridge.startAgent / bridge.stopAgent
  routes/messages.ts          ← daemonRegistry.send → bridge.deliverMessage
  delegation.ts               ← daemonRegistry.send → bridge.deliverMessage
  taskDelivery.ts             ← daemonRegistry.send → bridge.deliverMessage
  agentRuntimePatch.ts        ← Paseo 模式下跳过 runtime 校验（Paseo 管理可用 runtime）
  app.ts                      ← 根据 mode 初始化对应 bridge
  db.ts                       ← 新增 daemon mode 配置存储

packages/server/src/routes/
  internalAgent.ts            ← 无需改动（MCP bridge 直接调用）

packages/web/src/
  components/SettingsPanel.tsx ← 新增 Paseo Daemon 连接配置 UI
  components/AgentPanel.tsx   ← 显示 daemon mode（local / paseo）
```

### 3.3 最小改动文件

```
packages/shared/src/protocol.ts              ← 协议类型不变
packages/hub-core/                           ← 共享业务逻辑不变
packages/cloudflare/                         ← Cloudflare 部署不变
```

> **注意**：`routes/internalAgent.ts` 第 995 行有 `daemonRegistry.send()` 调用（`deliverDirectMessage`），
> 需在 Phase 1 bridge 改造中一并替换为 `bridge.deliverMessage()`。
> packages/server/src/routes/internalAgent.ts ← 须改造：第 995 行 `deliverDirectMessage` 直接调用 `daemonRegistry.send()`，需改为 `bridge.deliverMessage()`
> packages/shared/src/protocol.ts ← 协议类型不变
> packages/hub-core/ ← 共享业务逻辑不变
> packages/web/src/ ← 大部分 UI 不变
> packages/cloudflare/ ← Cloudflare 部署不变

````

---

## 四、配置模型（Phase 1 实现目标）

> **当前状态**：Crewden 代码尚无此配置系统。daemon 认证 key 仍是硬编码集合（`daemonSocket.ts:14 VALID_KEYS`），无 `CREWDEN_DAEMON_MODE` 环境变量，无 `/api/daemon/*` 端点。以下为 Phase 1 目标态设计。

### 4.1 Daemon Mode 配置

Crewden Server 新增 daemon mode 配置：

```typescript
// packages/server/src/config.ts

export type DaemonMode = "local" | "paseo";

export interface PaseoDaemonConfig {
  url: string; // e.g., "ws://127.0.0.1:6767"
  apiKey: string; // Paseo daemon auth token
}

export interface DaemonConfig {
  mode: DaemonMode;
  paseo?: PaseoDaemonConfig;
}
````

### 4.2 环境变量（Phase 1 实现）

> **当前状态**：`CREWDEN_DAEMON_MODE`、`PASEO_DAEMON_URL`、`PASEO_DAEMON_API_KEY` 均未实现。Phase 1 需在 `packages/server/src/` 新增 `config.ts` 并在 `app.ts` 中读取。

```bash
# Daemon mode 选择
CREWDEN_DAEMON_MODE=local      # "local"（默认）或 "paseo"

# Paseo Daemon 连接（mode=paseo 时需要）
PASEO_DAEMON_URL=ws://127.0.0.1:6767
PASEO_DAEMON_API_KEY=<token>
```

### 4.3 API 端点（Phase 1 实现）

> **当前状态**：`/api/daemon/*` 端点均不存在。Phase 1 需在 `routes/` 新增 `daemon.ts` 实现。

新增管理端点：

```
GET  /api/daemon/config          ← 获取当前 daemon mode 配置
PUT  /api/daemon/config          ← 更新 daemon mode 配置
GET  /api/daemon/status          ← 获取 daemon 连接状态（Paseo 模式下显示连接状态）
POST /api/daemon/connect         ← 手动触发连接（Paseo 模式）
POST /api/daemon/disconnect      ← 手动断开（Paseo 模式）
```

---

## 五、数据模型映射

### 5.1 Agent 映射

```
Crewden Agent                     Paseo ManagedAgent
─────────────                     ──────────────────
id: string                        id: string (不同值)
name: string                      labels["crewden.name"]
displayName: string               labels["crewden.displayName"]
runtime: RuntimeId                provider: AgentProvider (映射)
model: string                     config.model
systemPrompt: string              config.systemPrompt + Crewden 指令
machineId: string                 (由 Paseo 管理，不暴露)
status: AgentStatus               lifecycle: AgentLifecycleStatus (映射)
organization: {...}               labels["crewden.roles"] 等

映射存储：
  crewdenToPaseo: Map<crewdenAgentId, paseoAgentId>
  paseoToCrewden: Map<paseoAgentId, crewdenAgentId>
```

### 5.2 Status 映射

| Crewden AgentStatus | Paseo AgentLifecycleStatus | 说明                       |
| ------------------- | -------------------------- | -------------------------- |
| `inactive`          | 无对应                     | Paseo agent 未创建或已删除 |
| `starting`          | `initializing`             | Paseo agent 正在创建       |
| `running`           | `running`                  | Agent 正在执行             |
| `working`           | `running`                  | 同 running                 |
| `idle`              | `idle`                     | Agent 等待下一条消息       |
| `error`             | `error`                    | Agent 出错                 |

### 5.3 消息流映射

```
Crewden 消息投递:
  POST /api/channels/:id/messages
    → Server 创建 Message
    → Server 调用 bridge.deliverMessage(agentId, delivery)
    → PaseoDaemonMode:
        1. CrewdenContextInjector.buildDeliverPrompt(delivery)
        2. InboxAdapter.enqueue(agentId, delivery)
        3. → PaseoDaemonClient.sendMessage(paseoAgentId, prompt)
    → Paseo Agent 处理
    → Timeline 事件流回：
        1. TimelineToEventBridge.mapStreamEvent(event)
        2. 累积文本直到 run_finished
        3. 发射 AgentMessageEvent
    → Crewden Server 收到 AgentMessageEvent
        1. 创建 Message
        2. eventBus.emit({ type: 'message:new', message })
    → Browser WebSocket 推送
```

### 5.4 存储策略

| 数据                   | 存储位置             | 说明                                       |
| ---------------------- | -------------------- | ------------------------------------------ |
| Crewden Agent 元数据   | Crewden Store        | name, config, channelId, status            |
| Paseo Agent 运行时数据 | Paseo `$PASEO_HOME`  | timeline, workspace, session               |
| Agent ID 映射          | PaseoDaemonMode 内存 | crewdenToPaseo / paseoToCrewden Map        |
| Crewden 协作数据       | Crewden Store        | messages, tasks, goals, reviews, knowledge |

**映射持久化**：在 Crewden Agent 表新增独立字段 `runtimeInstanceId` 存储 Paseo agentId。

> **注意**：不能复用 `machineId` 字段，因为它在 Crewden 中语义为"daemon 机器标识"，直接影响路由投递（`daemonRegistry.send(machineId, ...)`）、自动启动（`resolveStartMachineId`）和机器状态联动（`daemonSocket.ts` 中 machine 下线时标记 agent 为 inactive）。复用会导致 LocalDaemonMode 下投递逻辑异常。
>
> 新增字段方案：
>
> ```sql
> ALTER TABLE agents ADD COLUMN runtime_instance_id TEXT;
> -- runtime_instance_id 仅在 PaseoDaemonMode 下使用，存储 Paseo agentId
> -- machineId 保持原有语义不变（LocalDaemonMode 下的机器标识）
> ```

---

## 六、实施阶段（修订版）

### Phase 0：概念验证（Week 1-2）

**目标**：验证 Paseo 客户端协议栈可以从 Node.js 服务端连接，完成最小闭环。

**任务**：

1. ~~抽取 Paseo `packages/server/src/client/` 核心模块为 `@getpaseo/client-sdk`~~ 已改为直接在 Crewden 中实现轻量客户端
2. 创建 `packages/paseo-client` 包骨架 ✅ 已完成
3. 实现 `PaseoDaemonClient` 轻量版（直接通过 ws 库连接 Paseo Daemon） ✅ 已完成
   - `connect(url, apiKey)` — 连接 Paseo Daemon（hello 握手）
   - `createAgent({ provider, cwd, initialPrompt })` — 创建 agent
   - `sendMessage(agentId, text)` — 发送消息
   - 订阅 agent stream 事件（`timeline`/`turn_completed` 等真实事件类型）
4. 编写 PoC 验证脚本 ✅ 已完成（`scripts/poc-connect.ts`）
5. 编写 mock daemon 集成测试 ✅ 已完成（17 个测试全部通过）
6. 验证 inbox 队列适配器在 turn-based 模型上的可行性 ✅ 已完成

**验收标准**：

- Node.js 脚本成功连接 Paseo Daemon
- 创建 agent、发送消息、接收回复的完整闭环
- 输出 Paseo 客户端协议适配可行性报告

**前置依赖**：

- Paseo Daemon 本地可用（`npm run dev`）
- API Key 配置

### Phase 1：抽象层 + 双模式共存（Week 3-5）

**目标**：在 Crewden Server 中引入 `AgentRuntimeBridge` 抽象层，支持 local-daemon 和 paseo-daemon 两种模式。

**任务**：

1. 定义 `AgentRuntimeBridge` 接口（`agent-runtime-bridge/types.ts`）
2. 实现 `LocalDaemonMode`（封装现有 daemonRegistry + daemonSocket）
3. 改造 `routes/agents.ts`、`routes/messages.ts`：
   - 将 `daemonRegistry.send(...)` 替换为 `bridge.startAgent(...)` / `bridge.deliverMessage(...)`
   - `delegation.ts`、`taskDelivery.ts` 同上
4. 实现 `PaseoDaemonMode`（基于 Phase 0 验证的 SDK）
5. 实现 `InboxAdapter`
6. 实现 `CrewdenContextInjector`（system prompt + 消息格式化）
7. `app.ts` 根据环境变量 `CREWDEN_DAEMON_MODE` 初始化对应 bridge
8. 新增 `/api/daemon/config`、`/api/daemon/status` 端点
9. Web UI 添加 daemon mode 切换开关（Settings 页面）

**验收标准**：

- `CREWDEN_DAEMON_MODE=local` 时行为与改造前完全一致
- `CREWDEN_DAEMON_MODE=paseo` 时能连接 Paseo Daemon
- Web UI 发消息 → Paseo Agent 处理 → 收到回复 → Channel 显示
- 现有测试全部通过（`pnpm verify`）

### Phase 2：MCP Bridge 迁移 + 核心 12 工具（Week 6-8）

**目标**：Paseo 模式下的 Agent 可以通过 MCP 工具调用 Crewden 协作功能。

**任务**：

1. 将 `packages/daemon/src/mcp/bridge.ts` 提取到 `packages/paseo-client/src/mcp-bridge/`
2. MCP bridge 作为独立可执行文件编译，作为 MCP Server 注入 Paseo Agent
3. 实现 12 个核心 MCP 工具（对齐现有功能）：
   - send_message, check_messages, read_history
   - send_dm, delegate_agent
   - list_agents, server_info
   - list_tasks, update_task_status
   - schedule_reminder, list_reminders, cancel_reminder
4. 实现 `TimelineToEventBridge`（检测 `crewden_*` MCP 工具调用，记录 activity）
5. 集成测试：Paseo Agent 通过 MCP 工具发消息、创建任务
6. 处理 Gemini runtime 不支持的情况（UI 提示 + fallback 到 local daemon）

**验收标准**：

- Paseo 模式下 Agent 可以 `send_message` 在 Channel 看到消息
- Paseo 模式下 Agent 可以 `list_tasks` 看到任务列表
- Paseo 模式下 Agent 可以 `delegate_agent` 触发委派
- 12 个工具均有对应的集成测试

### Phase 3：扩展工具 + 完整协作闭环（Week 9-11）

**目标**：补全所有协作工具，实现完整的 Agent 协作闭环。

**任务**：

1. 扩展 MCP 工具到 22 个：
   - claim_task, read_task, handoff_task, block_task, escalate_task, progress_task
   - search_knowledge, write_knowledge
   - list_goals, read_goal, create_goal_tasks
   - review_request, approve_review, request_changes
   - resolve_agent, list_reviews, create_channel, invite_agent
2. 改造 `taskDelivery.ts`：Paseo 模式下 task 通知通过 `bridge.deliverMessage` 投递
3. 改造 `delegation.ts`：Paseo 模式下委派通过 `bridge.startAgent` + `bridge.deliverMessage`
4. 实现 `agent:session` 事件转发（Paseo session ID 映射）
5. 实现 workspace 读取适配（Paseo Agent workspace → Crewden workspace browser）
6. 性能优化：stream 事件累积、inbox 投递批处理

**验收标准**：

- Agent 可以创建 Task → Claim → Progress → Handoff → Review → Approve 完整流程
- Agent 可以搜索和写入 Knowledge
- Agent 可以创建 Goal 并分解为 Tasks
- Agent 之间委派正常工作

### Phase 4：生产就绪 + 文档（Week 12-14）

**目标**：打磨错误处理、监控、文档，准备生产使用。

**任务**：

1. **错误处理**：
   - Paseo Daemon 断线自动重连
   - Agent 崩溃恢复（重启 Paseo Agent + 恢复 inbox）
   - MCP bridge 调用失败重试
2. **监控**：
   - Paseo 连接状态心跳
   - Agent 活动日志同步
   - 异常告警（连续失败、长时无响应）
3. **数据迁移**：
   - 从 local-daemon 模式迁移到 paseo-daemon 模式的指南
   - 现有 agent 配置导出/导入
4. **文档更新**：
   - 更新 README.md（新增 Paseo 模式说明）
   - 更新 AGENTS.md（新增 daemon mode 配置）
   - 更新 docs/（新增整合文档）
5. **可选：移除 local-daemon 模式**（Phase 4 后期，确认 Paseo 模式稳定后）
   - 删除 `packages/daemon`
   - 删除 `LocalDaemonMode`
   - 简化为仅 `PaseoDaemonMode`

**验收标准**：

- Paseo Daemon 断线后自动恢复
- 所有现有流程在 Paseo 模式下正常
- 文档完整
- `pnpm verify` 全绿

---

## 七、测试策略

### 7.1 单元测试

| 模块                      | 测试重点                                    |
| ------------------------- | ------------------------------------------- |
| `PaseoDaemonClient`       | 连接、创建 agent、发送消息、接收事件        |
| `InboxAdapter`            | 入队、出队、并发、idle 触发                 |
| `TimelineToEventBridge`   | 事件映射、文本累积、工具调用检测            |
| `CrewdenContextInjector`  | prompt 构建、MCP 配置生成                   |
| `AgentRuntimeBridge` 接口 | LocalDaemonMode 和 PaseoDaemonMode 行为一致 |
| MCP Bridge 工具           | 每个工具的参数解析、API 调用、返回值格式    |

### 7.2 集成测试

| 场景         | 验证内容                                                                  |
| ------------ | ------------------------------------------------------------------------- |
| 消息投递闭环 | Web UI → Server → PaseoDaemonMode → Paseo Daemon → Agent → 回复 → Channel |
| MCP 工具调用 | Agent 调用 `send_message` → Channel 出现消息                              |
| 任务创建     | Agent 调用 `create_task` → Task Board 显示                                |
| 委派流程     | Agent A 委派给 Agent B → Agent B 收到消息并开始处理                       |
| 断线重连     | Paseo Daemon 重启后 Crewden 自动恢复                                      |

### 7.3 端到端测试

使用 Paseo Daemon 的 mock provider（不需要真实 API key），验证完整协作流程。

---

## 八、风险与缓解（修订版）

| 风险                                   | 概率 | 影响 | 缓解方案                                                 |
| -------------------------------------- | ---- | ---- | -------------------------------------------------------- |
| Paseo 客户端 SDK 抽取复杂              | 中   | 高   | Phase 0 先验证，如抽取困难则直接 import 源码             |
| Paseo 二进制协议变更                   | 低   | 高   | 锁定 Paseo 版本；SDK 版本与 Daemon 版本对齐              |
| Inbox 队列在 turn-based 模型上丢失消息 | 中   | 高   | InboxAdapter 持久化到 Crewden Store；重连后恢复          |
| Gemini runtime 不支持                  | 确定 | 中   | Phase 0-2 明确不支持，提示用户使用 local 模式            |
| Agent 回复文本累积边界判断错误         | 中   | 中   | 基于 `run_finished` 事件而非文本量判断                   |
| MCP bridge 进程管理                    | 低   | 中   | Paseo 负责 MCP Server 生命周期，Crewden 仅提供可执行文件 |
| Paseo Daemon 端口冲突                  | 低   | 低   | 默认 6767，可配置；Crewden Server 用 3000                |
| 两套 ID 映射一致性                     | 中   | 高   | 映射关系持久化到 Crewden Store；启动时校验               |
| Cloudflare 部署不兼容                  | 低   | 中   | Cloudflare hub 不走 daemon，不受影响                     |

---

## 九、与原方案的差异总结

| 项目                     | 原方案              | 修订方案                                                       |
| ------------------------ | ------------------- | -------------------------------------------------------------- |
| **删除 daemon**          | Phase 3 一步删除    | Phase 4 后期可选删除，先共存                                   |
| **PaseoDaemonClient**    | 简单 WebSocket 封装 | 轻量级 ws 库直连，自行实现 JSON-over-WS 协议（Phase 0 已验证） |
| **Inbox 队列**           | 未提及              | 新增 InboxAdapter 适配 Paseo turn-based 模型                   |
| **MCP bridge**           | 未提及迁移          | 从 daemon 提取为独立可执行文件，注入 Paseo Agent               |
| **ACP 工具数量**         | 22 个一步到位       | 分两批：Phase 2 先 12 个核心，Phase 3 扩展到 22 个             |
| **Gemini 支持**          | 未提及不支持        | 明确 Phase 0-2 不支持，需 local daemon fallback                |
| **抽象层**               | 直接替换            | 引入 AgentRuntimeBridge 统一接口                               |
| **总工期**               | 6 周                | 14 周（含 Phase 0 验证）                                       |
| **@getpaseo/client-sdk** | 方案依赖该 SDK      | 不存在，已改为直接在 Crewden 中实现轻量客户端                  |
| **映射持久化**           | 仅内存              | 持久化到 Crewden Store + 启动校验                              |
