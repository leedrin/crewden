# Paseo × Crewden Integration Plan

> **分支**：`feat/crewden-integration`（基于 `main`）  
> **目标**：让 Paseo Daemon 作为 Crewden 的 Agent 运行时，Crewden Server 通过 Paseo 提供协作层（Channel/Task/Goal/Knowledge），两者协同实现 Agent 协作平台。

---

## 一、背景与目标

### 1.1 两个项目的定位

| 项目        | 定位             | 核心职责                                                                    |
| ----------- | ---------------- | --------------------------------------------------------------------------- |
| **Paseo**   | Agent 运行时平台 | CLI Agent 生命周期管理、WebSocket API、MCP Server、Timeline、Relay 远程访问 |
| **Crewden** | Agent 协作平台   | Channel 消息、Task Board、Goal 目标管理、Review 流程、Knowledge 知识库      |

### 1.2 整合目标

Crewden 目前有自己的 `packages/daemon`（Agent 进程管理），但功能远不如 Paseo 完善。

**整合策略**：用 Paseo Daemon 替换 Crewden 的 `packages/daemon`，Crewden Server 保留协作业务逻辑，两者通过 Paseo Client 连接。

整合后：

- **Paseo** 负责真正的 Agent 生命周期（创建/启动/停止/monitoring）
- **Crewden** 负责协作流程（Channel → Message → Task → Goal → Review）
- **Crewden Agent** 通过调用 `crewden_*` ACP 工具参与协作（发消息、创建任务、请求 Review 等）

---

## 二、架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                     Browser / Mobile                          │
│              (Crewden Web UI: Channel/DM/Task/Goal/Review)  │
└────────────────────┬─────────────────────────────────────────┘
                     │ HTTP REST + WebSocket
                     ▼
┌──────────────────────────────────────────────────────────────┐
│              Crewden Server（改造后）                          │
│                                                              │
│  REST API：Channel/Message/Task/Goal/Review/Knowledge        │
│  WebSocket Hub：Browser ←→ Server（协作状态实时推送）          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ PaseoDaemonClient（新增）                                │  │
│  │  - 连接本地/远程 Paseo Daemon（ws://host:port）         │  │
│  │  - Crewden 协作状态 ←→ Paseo Agent 生命周期映射        │  │
│  │  - ACP Tool Bridge（crewden_* 工具注入给 Agent）         │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────┬─────────────────────────────────────────┘
                     │ WebSocket（daemon protocol）
                     ▼
┌──────────────────────────────────────────────────────────────┐
│              Paseo Daemon（Node.js）                           │
│  AgentManager · ACP Provider · Timeline · MCP Server          │
└────────────────────┬─────────────────────────────────────────┘
                     │ ACP Protocol
                     ▼
┌──────────────────────────────────────────────────────────────┐
│          CLI Agents: claude | codex | opencode               │
└──────────────────────────────────────────────────────────────┘
```

**关键变化：**

- `crewden/packages/daemon` **删除**，替换为 Paseo Daemon Client
- `crewden/packages/server` 中 Agent 运行时相关代码**删除**，由 Paseo 接管
- Crewden Server 保留 Fastify REST API + WebSocket Hub + 协作业务逻辑
- Paseo Daemon 接管真正的 Agent 生命周期

---

## 三、模块改造清单

### 3.1 删除的模块（Crewden）

```
packages/daemon/                          ← 完全删除
  src/
    agentProcessManager.ts
    bridge/
    drivers/
    runtimeDetector.ts
    mcp/

packages/server/src/
  daemonRegistry.ts                       ← 删除
  runtimeConfig.ts                        ← 删除
  taskDelivery.ts                         ← 改造（保留派发逻辑，删进程管理）
  delegation.ts                           ← 改造（保留委派逻辑，删 spawn）
  agentRuntimePatch.ts                    ← 删除
```

### 3.2 新增的模块

```
packages/paseo-client/（新增 npm 包）
  src/
    PaseoDaemonClient.ts                   ← 连接 Paseo Daemon，封装 ACP 协议
    PaseoSessionBridge.ts                 ← Timeline 事件 → Crewden WebSocket 桥接
    CrewdenACPTools.ts                    ← Crewden ACP 工具集（22 个工具）
    types.ts                              ← Crewden ←→ Paseo 类型映射

packages/server/src/
  paseo-daemon-client.ts                  ← Server 端单例
  taskRouter.ts                           ← Crewden Task → Paseo Agent 执行路由
  goalRouter.ts                           ← Crewden Goal → Paseo Agent 上下文
```

### 3.3 改造的模块

```
packages/server/src/
  messages.ts      — 消息发送通过 PaseoDaemonClient 触发 Agent
  agents.ts       — 创建/启停改为调用 Paseo Client
  tasks.ts        — 任务状态变化通过 Paseo Client 通知 Agent
  internalAgent.ts — inbox/work API 改为 Paseo Session 查询

packages/web/src/
  AgentPanel.tsx  — 改为连接状态面板，显示 Paseo Agent 运行时
```

---

## 四、核心模块设计

### 4.1 PaseoDaemonClient

连接 Paseo Daemon 并管理 Agent 会话：

```typescript
export class PaseoDaemonClient {
  private ws: WebSocket | null = null;

  async connect(daemonUrl: string, apiKey: string): Promise<void>;
  async createAgent(config: CrewdenAgentConfig): Promise<PaseoAgentHandle>;
  async sendMessage(
    agentId: string,
    content: string,
    context: CrewdenMessageContext,
  ): Promise<void>;
  subscribeToAgent(agentId: string, ws: WebSocket): void;
  disconnect(): void;
}
```

**Daemon 发现机制：**

- 默认：`ws://127.0.0.1:6767`（Paseo 默认端口）
- 支持 QR 扫码（Paseo Mobile App onboarding）
- 支持手动 URL 输入

### 4.2 CrewdenACPTools（Crewden ACP 工具集）

Agent 调用后由 Crewden Server 处理：

| 工具名                     | 描述                    |
| -------------------------- | ----------------------- |
| `crewden_send_message`     | 发送消息到 Channel      |
| `crewden_create_task`      | 创建任务                |
| `crewden_update_task`      | 更新任务状态            |
| `crewden_delegate`         | 委派给另一个 Agent      |
| `crewden_create_goal`      | 创建 Goal               |
| `crewden_set_reminder`     | 设置提醒                |
| `crewden_search_knowledge` | 搜索知识库              |
| `crewden_review_request`   | 请求 Review             |
| `crewden_upload_knowledge` | 上传知识                |
| `crewden_list_channels`    | 列出所有 Channel        |
| `crewden_list_tasks`       | 列出任务                |
| `crewden_get_task`         | 获取任务详情            |
| `crewden_list_agents`      | 列出所有 Agent          |
| `crewden_get_agent_status` | 获取 Agent 状态         |
| `crewden_create_channel`   | 创建 Channel            |
| `crewden_invite_agent`     | 邀请 Agent 加入 Channel |
| `crewden_resolve_thread`   | 标记 Thread 已解决      |
| `crewden_add_reaction`     | 添加表情回应            |
| `crewden_get_goal`         | 获取 Goal 详情          |
| `crewden_update_goal`      | 更新 Goal               |
| `crewden_close_goal`       | 关闭 Goal               |
| `crewden_list_reviews`     | 列出待 Review 项        |

### 4.3 PaseoSessionBridge

Timeline 事件 → Crewden WebSocket 推送的桥接：

```typescript
export class PaseoSessionBridge {
  mapTimelineEvent(event: PaseoTimelineEvent): CrewdenBrowserEvent | null {
    switch (event.kind) {
      case "agent_stream":
        return { type: "message:new", message: toCrewdenMessage(event) };
      case "tool_call":
        if (isCrewdenTool(event.toolName)) {
          return this.handleCrewdenToolCall(event); // → Crewden API
        }
        return null;
      case "finished":
        return { type: "agent:finished", agentId: event.agentId };
      case "error":
        return { type: "agent:error", agentId: event.agentId, error: event.error };
    }
  }
}
```

---

## 五、User Flow 改造

### 场景 1：用户在 Channel 发送消息

```
旧流程：
User → Crewden Server → daemonRegistry → agentProcessManager → CLI Agent

新流程：
User → Crewden Server → PaseoDaemonClient → Paseo Daemon → CLI Agent
       ↑                                              │
       └──────────── WebSocket (Timeline) ←───────────┘
```

### 场景 2：Agent 调用 crewden_create_task

```
Paseo Agent (CLI)
  ↓
[[CREWDEN_TOOL:crewden_create_task]]
  ↓
PaseoSessionBridge 拦截工具调用
  ↓
Crewden Server API：POST /api/tasks
  ↓
Crewden Store 持久化
  ↓
Crewden WebSocket → Browser (Task Board 更新)
```

### 场景 3：Agent 之间委派

```
Agent A → crewden_delegate(to="Agent B")
  ↓
Crewden Server → 查找 Agent B 对应的 Paseo Agent Handle
  ↓
PaseoDaemonClient.sendMessage(Agent B, delegationContent)
  ↓
Agent B 开始处理
```

---

## 六、数据模型映射

| Crewden 概念 | Paseo 概念          | 映射策略                                              |
| ------------ | ------------------- | ----------------------------------------------------- |
| Agent        | ManagedAgent        | 1:1 映射，创建时同时在两边建立记录                    |
| Channel      | Workspace / Project | 1:N：Crewden Channel → Paseo Project                  |
| Message      | Timeline Event      | Message → Paseo Timeline Event，通过 Bridge 转换      |
| Task         | Task                | Task 存在 Crewden Store；Agent 持有 taskId 作为上下文 |
| Goal         | Task Goal Context   | Goal 存在 Crewden Store；TaskContext 引用 goalId      |
| Machine      | Daemon Instance     | Crewden Machine → Paseo Daemon Host                   |

**存储策略**：保持 Crewden Store 独立，Paseo 存储（`$PASEO_HOME/agents/*.json`）独立。两套存储通过 PaseoDaemonClient 的内存句柄（`agentId`）关联。

---

## 七、实施阶段

### Phase 1：Paseo 连接层（Week 1-2）

**目标**：Crewden Server 能连接 Paseo Daemon，发送消息并收到响应。

**任务**：

1. 创建 `packages/paseo-client` 包
2. 实现 `PaseoDaemonClient`（WebSocket 连接、握手、Timeline 订阅）
3. 实现 `CrewdenACPTools`（先做 5 个核心工具：message/task/delegate/reminder/knowledge）
4. 改造 `messages.ts`：`POST /api/channels/:id/messages` 走 PaseoDaemonClient
5. Web UI 添加连接 Paseo Daemon 的 Settings 页面

**验收标准**：Web UI 发消息 → Paseo Agent 处理 → 收到回复 → Channel 显示

### Phase 2：Crewden ACP 工具集（Week 3）

**目标**：Agent 可以调用 Crewden 协作工具，完成完整闭环。

**任务**：

1. 完成全部 22 个 Crewden ACP Tools
2. 实现 `PaseoSessionBridge`（拦截 `crewden_*` 工具调用 → Crewden API → 返回结果）
3. 改造 `tasks.ts`：Task 创建/状态变化通过 Paseo Client 通知相关 Agent
4. 实现 `crewden_delegate` 委派流程
5. 实现 `crewden_set_reminder`：Crewden 定时触发 → Paseo Client → 推送消息

**验收标准**：

- Agent 可以 `crewden_create_task` 在 Task Board 看到任务
- Agent 可以 `crewden_send_message` 在 Channel 看到消息
- Agent 可以 `crewden_delegate` 让另一个 Agent 开始工作

### Phase 3：Agent 生命周期接管（Week 4-5）

**目标**：完全删除 Crewden daemon，用 Paseo 接管所有 Agent 运行时。

**任务**：

1. 删除 `packages/daemon` 包
2. 删除 `daemonRegistry.ts`、`runtimeConfig.ts`、`agentRuntimePatch.ts`
3. 改造 `agents.ts`：创建/启停/绑定 Machine → 全部通过 PaseoDaemonClient
4. 改造 `internalAgent.ts`：inbox/work API → 查询 Paseo Session 状态
5. 改造 `delegation.ts`：删除 spawn 逻辑，改为 Paseo 跨 Agent 消息
6. Web UI AgentPanel 改造：去掉 Runtime 下拉，显示 Paseo Agent 连接状态

**验收标准**：`pnpm verify` 全绿，所有现有流程走 Paseo

### Phase 4：打磨与文档（Week 6）

- 完善错误处理（Daemon 断线重连、Agent 崩溃恢复）
- 更新 `docs/` 相关文档
- 更新 `AGENTS.md` 和 `README.md`
- 更新 Cloudflare 部署说明

---

## 八、关键风险与缓解

| 风险                                     | 概率 | 影响 | 缓解方案                                           |
| ---------------------------------------- | ---- | ---- | -------------------------------------------------- |
| Paseo Daemon 与 Crewden Server 断线      | 中   | 中   | 断线检测 + 手动重连 UI；消息入队                   |
| Agent 调用 `crewden_*` 工具返回错误      | 中   | 中   | 每个工具独立 try/catch；优雅降级                   |
| Paseo 与 Crewden 类型不兼容              | 低   | 高   | Phase 1 先验证协议兼容性                           |
| Crewden Web UI 与 Paseo Agent 状态不同步 | 中   | 中   | 通过 Timeline Bridge 强制同步                      |
| Paseo 版本升级破坏 ACP 兼容性            | 低   | 高   | 锁定 `@agentclientprotocol/sdk` 版本；集成测试覆盖 |
| Crewden 用户已有数据丢失                 | 低   | 高   | Phase 3 前完成数据迁移测试；保留旧数据导出         |

---

## 九、前置依赖

在开始 Phase 1 之前需确认：

1. **Daemon URL 发现**：Crewden 用户如何找到本机/远程 Paseo Daemon？
   - 默认 `localhost:6767`
   - 支持 QR 扫码（Paseo Mobile App onboarding）
   - 支持手动 URL 输入

2. **API Key 认证**：Crewden Server 连接 Paseo Daemon 用什么凭证？
   - Paseo 目前支持 token 认证
   - 需要 Crewden 用户在 Paseo App 生成访问 token

3. **Provider 选择**：Crewden 用户选"Claude"时，创建的是 Paseo Agent？
   - 统一策略：通过 PaseoDaemonClient 创建，Provider 透明传递给 Paseo
