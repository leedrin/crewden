# Paseo × Crewden 整合详细功能设计方案 V2

> 本版以 `docs/integration/CREWDEN_INTEGRATION.md` 第一章“背景与目标”作为最高约束：
>
> - Paseo 是唯一 Agent Runtime 基座
> - Crewden daemon 必须退役
> - Crewden 保留并强化协作层

---

## 一、整合策略

### 1.1 核心原则

1. **Paseo 管生命周期，Crewden 管协作** — Paseo Daemon 负责 Agent 进程的创建、启动、停止、monitoring、session persistence；Crewden Server 负责 Channel/Message/Task/Goal/Review/Knowledge 协作逻辑。
2. **终态单 Runtime，不保留双栈** — 允许迁移窗口短期兼容，但最终只能保留 Paseo Runtime，`packages/daemon` 与 server 内 daemon 直连路径必须删除。
3. **轻量协议客户端，不阻塞于 SDK 抽取** — `PaseoDaemonClient` 直接以 `ws` 实现 JSON-over-WS 协议适配，不依赖不存在的 `@getpaseo/client-sdk`。
4. **MCP Bridge 迁移优先于工具重写** — 先提取并复用 `packages/daemon/src/mcp/bridge.ts` 的成熟能力，再扩展到完整 22 工具闭环。
5. **分层清晰，调用单入口** — Crewden Server 内所有 Agent 生命周期与消息投递路径统一走 `PaseoRuntimeService`（或 `PaseoDaemonMode`），禁止新增 `daemonRegistry.send(...)` 新调用点。

### 1.2 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                     Client Layer                                 │
│ Browser / Mobile (Crewden Web UI)                               │
│ Channel / DM / Task / Goal / Review / Knowledge                 │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTP REST + WebSocket (/ws)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Collaboration Layer                          │
│ Crewden Server                                                   │
│ - REST API: channels/messages/tasks/goals/reviews/knowledge     │
│ - WebSocket Hub: browser state fanout                            │
│ - Internal Agent API: MCP bridge callback surface                │
│ - PaseoRuntimeService: runtime single entrypoint                 │
└────────────────────────┬─────────────────────────────────────────┘
                         │ WebSocket (Paseo session protocol)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Runtime Layer                               │
│ Paseo Daemon                                                     │
│ - AgentManager                                                   │
│ - Providers (claude/codex/opencode/...)                         │
│ - Timeline stream + persistence                                  │
│ - MCP orchestration                                              │
└────────────────────────┬─────────────────────────────────────────┘
                         │ ACP/provider SDK
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Execution Layer                             │
│ CLI Agents: claude | codex | opencode | ...                     │
└──────────────────────────────────────────────────────────────────┘
```

**迁移窗口（非终态）**

```
Phase 1 可存在：
  LegacyLocalRuntimeAdapter(local-daemon) + PaseoRuntimeService
Phase 2 结束必须收敛为：
  PaseoRuntimeService only
```

**关键变化（相对初版修订稿）**

- `LocalDaemonMode` 从“可选长期模式”改为“迁移期临时兼容适配器”
- `packages/daemon` 删除从“可选”改为“必达里程碑”
- `CREWDEN_DAEMON_MODE` 从产品配置改为迁移期开关（默认 Paseo，最终移除）
- 所有路由、任务分发、委派、internalAgent 投递统一改为单运行时入口

---

## 二、核心模块设计

### 2.1 AgentRuntimeBridge（统一抽象层，迁移期）

定义 Crewden Server 与 Agent 运行时交互的统一接口，屏蔽底层差异。

```typescript
// packages/server/src/agent-runtime-bridge/types.ts

export interface AgentRuntimeBridge {
  readonly mode: "paseo-daemon" | "legacy-local";

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

**接口落地策略：**

- **终态实现**：`PaseoDaemonMode`（唯一）
- **迁移期实现**：`LegacyLocalRuntimeAdapter`（仅用于灰度回滚）
- **删除时机**：Phase 2 完成后删除 `legacy-local` 实现与引用路径

**legacy-local 映射（迁移期，仅供替换存量调用）：**

| `AgentRuntimeBridge` 方法 | `LegacyLocalRuntimeAdapter` 对应实现                             |
| ------------------------- | ---------------------------------------------------------------- |
| `startAgent`              | `daemonRegistry.send(machineId, { type: 'agent:start', ... })`   |
| `stopAgent`               | `daemonRegistry.send(machineId, { type: 'agent:stop', ... })`    |
| `deliverMessage`          | `daemonRegistry.send(machineId, { type: 'agent:deliver', ... })` |
| `readWorkspace`           | `daemonRegistry.readWorkspace(machineId, ...)`                   |
| `onAgentStatusChange`     | 监听 `ws/daemonSocket.ts` 中 `agent:status` 消息                 |
| `onAgentMessage`          | 监听 `ws/daemonSocket.ts` 中 `agent:message` 消息                |

### 2.2 LegacyLocalRuntimeAdapter（迁移期兼容适配）

将现有 `daemonRegistry` + `daemonSocket.ts` 的逻辑封装为兼容适配器，用于迁移窗口内灰度和回滚。该适配器不是长期产品能力。

```typescript
// packages/server/src/agent-runtime-bridge/legacy-local-runtime-adapter.ts

export class LegacyLocalRuntimeAdapter implements AgentRuntimeBridge {
  readonly mode = "legacy-local" as const;

  // 内部持有 daemonRegistry 实例
  // 将 daemonSocket.ts 中的消息处理逻辑重定向到 callback
  // startAgent → daemonRegistry.send(machineId, { type: 'agent:start', ... })
  // deliverMessage → daemonRegistry.send(machineId, { type: 'agent:deliver', ... })
  // onAgentMessage → 注册到 daemonSocket 消息分发器
}
```

**迁移期改造范围：**

- `daemonSocket.ts`：消息处理逻辑提取为事件发射器，由 `LegacyLocalRuntimeAdapter` 订阅
- `daemonRegistry.ts`：保持不变，作为底层传输
- `routes/agents.ts`、`routes/messages.ts`：将 `daemonRegistry.send(...)` 调用替换为 `bridge.deliverMessage(...)`
- `delegation.ts`、`taskDelivery.ts`：同上

**强制退出条件（进入 Phase 2）**

- `routes/*`、`delegation.ts`、`taskDelivery.ts`、`internalAgent.ts` 不再依赖 `legacy-local`。
- `daemonRegistry.send(...)` 不再作为主链路调用。
- 兼容适配器仅保留至切换完成；Phase 2 末删除。

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

## 三、Server 端改造清单（V2 强制收敛）

### 3.1 新增文件

```
packages/server/src/
  runtime/
    paseo-runtime-service.ts         ← 单运行时入口（唯一主链路）
    runtime-instance-mapper.ts       ← crewdenAgentId <-> paseoAgentId 映射持久化
  agent-runtime-bridge/
    types.ts                         ← 统一接口（迁移期使用）
    paseo-daemon-mode.ts             ← 终态实现（唯一）
    legacy-local-runtime-adapter.ts  ← 迁移期兼容（Phase 2 删除）

packages/paseo-client/
  src/
    index.ts
    paseo-daemon-client.ts
    inbox-adapter.ts
    timeline-to-event-bridge.ts
    crewden-context-injector.ts
    runtime-mapper.ts
    mcp-bridge/
      index.ts
      server.ts
      tools.ts
    types.ts
  package.json
  tsconfig.json
```

### 3.2 改造文件（必须完成）

```
packages/server/src/
  routes/agents.ts                ← 全量走 runtime service
  routes/messages.ts              ← 全量走 runtime service
  routes/internalAgent.ts         ← deliverDirectMessage 改为 runtime service
  delegation.ts                   ← 全量走 runtime service
  taskDelivery.ts                 ← 全量走 runtime service
  app.ts                          ← 初始化 PaseoRuntimeService
  db.ts                           ← 新增 runtimeInstanceId 字段与索引
  schema.ts                       ← agents 表结构更新

packages/web/src/
  components/SettingsPanel.tsx    ← Paseo 连接配置、迁移状态、健康诊断
  components/AgentPanel.tsx       ← 显示 runtime 实例状态（不再显示 local/paseo 双模式）
```

### 3.3 删除文件（Phase 2 必须完成）

```
packages/daemon/**                    ← 删除整包
packages/server/src/daemonRegistry.ts ← 删除
packages/server/src/ws/daemonSocket.ts← 删除
packages/server/src/runtimeConfig.ts  ← 删除
packages/server/src/agentRuntimePatch.ts ← 删除
```

### 3.4 最小改动文件

```
packages/shared/src/protocol.ts  ← 协议类型尽量兼容，仅新增可选字段
packages/hub-core/               ← 共享业务逻辑复用
packages/cloudflare/             ← 不引入 daemon 依赖，保持部署路径稳定
```

### 3.5 关键替换检查单（Code Review Gate）

- [ ] `rg -n \"daemonRegistry\\.send\\(\" packages/server/src` 无运行时主链路残留。
- [ ] `routes/internalAgent.ts` 不再直接访问 legacy daemon 通道。
- [ ] `app.ts` 仅注入 `PaseoRuntimeService` 作为生产默认 runtime。
- [ ] `packages/daemon` 在 Phase 2 合并前标记 deprecated，Phase 2 合并后物理删除。

---

## 四、配置模型（V2：单 Runtime 目标态）

### 4.1 Runtime 配置（终态）

```typescript
// packages/server/src/config.ts

export interface PaseoRuntimeConfig {
  url: string; // ws://127.0.0.1:6767
  apiKey: string;
  reconnect: {
    enabled: boolean;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  requestTimeoutMs: number;
}

export interface RuntimeConfig {
  provider: "paseo"; // 终态固定值
  paseo: PaseoRuntimeConfig;
}
```

### 4.2 迁移期开关（仅 Phase 1 使用，Phase 2 删除）

```bash
# 终态配置
PASEO_DAEMON_URL=ws://127.0.0.1:6767
PASEO_DAEMON_API_KEY=<token>

# 迁移期开关（仅灰度回滚）
CREWDEN_ENABLE_LEGACY_LOCAL_RUNTIME=false
```

约束：

- `CREWDEN_ENABLE_LEGACY_LOCAL_RUNTIME` 默认 `false`。
- Phase 2 结束删除该开关与所有代码分支。

### 4.3 API 端点（运维与观测）

```
GET  /api/runtime/config        ← 返回当前 runtime provider（固定 paseo）与连接参数摘要
PUT  /api/runtime/config        ← 更新 Paseo runtime 配置
GET  /api/runtime/status        ← 连接状态、重连次数、最后错误、心跳时间
POST /api/runtime/reconnect     ← 手动重连
```

> 不再对外提供 “local/paseo mode 切换” 端点；双模式仅在迁移窗口内以服务端内部开关存在。

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
        2. 基于 timeline.item + turn_completed 边界聚合输出
        3. 发射 AgentMessageEvent / AgentActivityEvent
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

## 六、实施阶段（V2：强制收敛到 Paseo 单 Runtime）

### Phase 0：协议可行性验证（Week 1-2，已具备）

**目标**：确认 Crewden 侧可稳定连接 Paseo，并完成最小消息闭环。

**任务**：

1. `packages/paseo-client` 包骨架建立。
2. 轻量 `PaseoDaemonClient` 打通 `connect/createAgent/sendMessage/stream`。
3. mock daemon 集成测试覆盖 handshake、requestId 关联、stream 分发。
4. 验证 InboxAdapter 在 turn-based 模型上的排队可行性。

**验收标准**：

- 创建 agent、发消息、收回复闭环可复现。
- 连接中断后的重连路径可复现。

### Phase 1：主链路迁移（Week 3-5，允许短暂兼容）

**目标**：把所有业务入口切到 `PaseoRuntimeService`，legacy-local 仅保留回滚能力。

**任务**：

1. 定义并落地 `PaseoRuntimeService` + `runtimeInstanceId` 映射持久化。
2. 改造 `routes/agents.ts`、`routes/messages.ts`、`routes/internalAgent.ts`、`delegation.ts`、`taskDelivery.ts`：
   - 全部调用 runtime service。
   - 禁止新增 `daemonRegistry.send(...)` 调用。
3. 落地 `PaseoDaemonMode`、`InboxAdapter`、`CrewdenContextInjector`。
4. 提取 MCP Bridge 到 `packages/paseo-client/src/mcp-bridge/` 并注入 Paseo Agent。
5. Web UI 增加 runtime 连接状态与诊断页面（非模式切换）。

**验收标准**：

- 生产默认路径全部走 Paseo Runtime。
- legacy-local 仅在显式迁移开关下可启用。
- 端到端流程：发消息、委派、任务更新可用。

### Phase 2：切换完成（Week 6-8，强制删除旧 Runtime）

**目标**：完成从“迁移兼容”到“单 Runtime”切换，删除 Crewden daemon 相关模块。

**任务**：

1. 删除 `packages/daemon/**`。
2. 删除 server 侧 `daemonRegistry.ts`、`ws/daemonSocket.ts`、`runtimeConfig.ts`、`agentRuntimePatch.ts`。
3. 删除 `legacy-local` 适配器、相关环境开关与分支代码。
4. 完成 12 个核心 MCP 工具联调（message/task/delegate/reminder/agent info）。
5. 清理文档与脚本中 local daemon 启动与连接描述。

**验收标准**：

- 代码库中不再存在旧 runtime 主链路。
- `rg -n "daemonRegistry\\.send\\(" packages/server/src` 仅允许历史注释或测试固件引用。
- 全部协作主流程仅依赖 Paseo Runtime。

### Phase 3：协作闭环扩展（Week 9-11）

**目标**：扩展到 22 工具并完成协作域全闭环。

**任务**：

1. 工具从核心 12 扩展到 22（task/goals/reviews/knowledge/channel/invite）。
2. 实现 session 映射、workspace 读取适配、activity log 对齐。
3. 优化 stream 处理与 inbox 批投递策略。
4. 增加失败重试、幂等键、死信记录。

**验收标准**：

- Task 生命周期：create/claim/progress/handoff/review/approve 全流程可回归。
- Goal 分解、Knowledge 读写、Agent 委派稳定。

### Phase 4：生产化与治理（Week 12-14）

**目标**：可观测、可恢复、可运维。

**任务**：

1. 连接健康、重连策略、异常告警完善。
2. inbox 持久化恢复、MCP bridge 进程健康检查。
3. 迁移手册、回滚预案、运维手册、发布检查表完善。
4. 清理旧 daemon 文档、命令、环境变量和 UI 文案。

**验收标准**：

- 断线恢复和故障自愈能力通过演练。
- 文档与代码一致声明 “Paseo 为唯一 Runtime”。
- `pnpm verify` 全绿。

---

## 七、测试策略

### 7.1 单元测试

| 模块                      | 测试重点                                        |
| ------------------------- | ----------------------------------------------- |
| `PaseoDaemonClient`       | 连接、创建 agent、发送消息、接收事件            |
| `InboxAdapter`            | 入队、出队、并发、idle 触发                     |
| `TimelineToEventBridge`   | 事件映射、文本累积、工具调用检测                |
| `CrewdenContextInjector`  | prompt 构建、MCP 配置生成                       |
| `AgentRuntimeBridge` 接口 | `legacy-local` 与 `paseo-daemon` 迁移期行为对齐 |
| MCP Bridge 工具           | 每个工具的参数解析、API 调用、返回值格式        |

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

## 八、风险与缓解（V2）

| 风险                                   | 概率 | 影响 | 缓解方案                                                |
| -------------------------------------- | ---- | ---- | ------------------------------------------------------- |
| Paseo 协议演进导致客户端不兼容         | 中   | 高   | 锁定 Paseo 版本；建立协议契约测试；引入兼容层解析       |
| Inbox 队列在 turn-based 模型上丢失消息 | 中   | 高   | InboxAdapter 持久化到 Crewden Store；重连恢复；死信记录 |
| runtimeInstanceId 映射异常             | 中   | 高   | DB 唯一索引 + 启动校验 + orphan 清理作业                |
| MCP bridge 子进程异常退出              | 中   | 中   | 进程健康检查、重启退避、调用超时与熔断                  |
| Phase 2 删除旧 daemon 时回归风险       | 中   | 高   | Phase 1 完成全链路回归后再切换；预设回滚 tag；灰度发布  |
| Gemini runtime 不支持                  | 确定 | 中   | UI 限制与错误提示；提供可选替代 runtime                 |
| Paseo Daemon 端口或认证配置错误        | 低   | 中   | 配置校验端点、连接诊断页、启动时自检                    |
| Cloudflare 部署路径误接入 runtime      | 低   | 中   | 明确 cloudflare 不走 daemon；CI 增加部署路径断言        |

---

## 九、与原方案的差异总结

| 项目                  | 初版方案（CREWDEN_INTEGRATION.md） | V2 最终方案                                                   |
| --------------------- | ---------------------------------- | ------------------------------------------------------------- |
| **运行时定位**        | Paseo 替换 Crewden daemon          | 保持一致：Paseo 唯一 runtime，Crewden daemon 退役             |
| **迁移策略**          | 偏直接替换                         | 先迁移主链路，后强制删除旧 runtime（Phase 2 必达）            |
| **抽象层**            | 未细化迁移兼容                     | `AgentRuntimeBridge` + `legacy-local` 仅迁移期存在            |
| **PaseoDaemonClient** | 简化描述                           | 轻量 ws 协议客户端，完整 requestId/stream/重连设计            |
| **MCP bridge**        | 工具层提及                         | 明确从 daemon 提取为独立可执行并注入 Paseo Agent              |
| **工具交付**          | 22 工具目标                        | 分阶段：核心 12 → 扩展 10（共 22）                            |
| **数据映射**          | 概念映射                           | 新增 `runtimeInstanceId` 持久化与一致性校验                   |
| **配置模型**          | daemon mode 思路                   | 终态固定 `provider=paseo`；`legacy-local` 开关仅 Phase 1 有效 |
| **删除旧模块**        | 方向明确但未细化                   | 列出必须删除文件清单与代码审查 gate                           |
| **终态定义**          | 目标导向                           | 文档、代码、运维三层统一声明 “Paseo is the only runtime”      |
