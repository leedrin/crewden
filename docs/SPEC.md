# Crewden — Spec Doc (v2.x)

> 本文档是项目的长期规格说明，记录系统设计、协议约定、开发规范和迭代路线。v2.x 以「Slack-like 面向 AI Agent 的协作式研发操作系统」为目标，基于 Paseo Runtime 单栈基座。
>
> 详细设计见：[Slack-like AI Agent 协作式研发操作系统完整设计](./slack/SLACK_LIKE_AI_AGENT_DESIGN.md)
> 功能 PRD：[AI Agent 协作式研发操作系统 PRD](./slack/SLACK_LIKE_AI_AGENT_PRD.md)
> 迭代路线：[ROADMAP.md](./ROADMAP.md) / [ROADMAP_V2.md](./slack/ROADMAP_V2.md)

---

## 1. 项目概述

**Crewden** 是一个自托管的 AI Agent 协作工作台，类似 Slack + AI agents 的协作产品。用户可以在 Web 界面创建和管理 AI Agent，通过聊天频道与 Agent 交互。Agent 通过 Paseo Daemon 持久会话运行，支持 Claude Code、Codex CLI、Gemini CLI、Pi 等多种 runtime。

**核心价值：**
- 完全自托管，数据不出本地
- Paseo Runtime 持久会话 + Turn-based 执行
- Cloudflare Worker + Durable Object 生产部署
- Agent 角色/权限/能力体系
- Task Board + 10 态状态机执行追踪

### 1.1 v2.x 产品方向

从 v1.x "Agent 协作工作台"升级为 v2.x **"Slack-like 面向 Agent 的协作式研发操作系统"**。7 层架构：协作层 → 对话引擎 → 编排器 → Runtime + Task Engine → MCP 工具 → 审计 → 审批。

核心闭环：`讨论 → 文档 → 任务 → 执行 → Review → 合并 → 沉淀`

详细设计原则和数据模型见 [v2.x 完整设计方案](./slack/SLACK_LIKE_AI_AGENT_DESIGN.md)。

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React + Vite :5173)                               │
│  - Sidebar: Channels / Agents / Tasks / Inbox / Knowledge   │
│  - ChannelView: 消息列表 / Thread 面板                      │
│  - TaskBoard: 5 列 Kanban 看板                              │
│  - Agent Panel / Decision / Document / Project Switcher     │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP REST + WebSocket
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (crewden-hub)        ← 生产环境           │
│  - Durable Object + SQLite：所有持久化数据                   │
│  - REST API：channels / tasks / agents / threads / ...      │
│  - WebSocket：实时 push 消息/状态变更                        │
│  - Autopilot：Durable Object Alarm 定时触发                  │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────┴──────────────────────────────────────────────┐
│  Node.js Server (Fastify :3000)        ← 本地开发/混合部署   │
│  - SQLite (libsql + Drizzle ORM)：本地开发存储               │
│  - Repository 层：数据访问抽象                               │
│  - REST + WebSocket API（与 Cloudflare 对等）                │
│  - Paseo Client：连接 Paseo Daemon，管理 Agent 生命周期       │
└──────────────┬──────────────────────────────────────────────┘
               │ WebSocket (Paseo Protocol)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Paseo Daemon                                               │
│  - Agent 持久会话（Turn-based 执行）                         │
│  - Context Injection：每个 turn 注入 Context Package         │
│  - MCP Bridge：tools 暴露为 crewden_* 工具                   │
│  - Runtime 适配：claude / codex / gemini / pi               │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 数据流决策

1. **Cloudflare 是生产单一数据源** — 所有持久化读写走 Cloudflare Worker → Durable Object SQLite
2. **Server 本地 SQLite** — 仅用于开发/本地模式，不与 Cloudflare 双向同步
3. **Web 是纯前端 SPA** — 不依赖任何 `@crewden/*` 运行时包，通过 HTTP/WS 通信
4. **消息推送链路**：Agent → Paseo Daemon → Paseo Client → Server → Cloudflare → Web

---

## 3. Monorepo 结构

```
crewden/
├── package.json                 # root scripts: dev, verify
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── AGENTS.md                    # Agent 开发规则
├── windows.txt                  # Windows 一键启动脚本
├── .env.example
├── docs/
│   ├── SPEC.md                  # 本文档
│   ├── ROADMAP.md               # 长期迭代路线
│   ├── architecture-analysis.md # 架构评审报告
│   ├── for_coding_agent/        # coding-agent 交接笔记
│   └── slack/                   # v2.x 设计文档 / 各版本实现计划
├── scripts/
│   └── verify.ts
└── packages/
    ├── shared/                  # @crewden/shared
    │   └── src/
    │       ├── protocol.ts      # 全部 TypeScript 类型定义
    │       ├── validation.ts    # Zod schema（与 protocol.ts 同步）
    │       └── version.ts       # 共享版本号
    ├── hub-core/                # @crewden/hub-core
    │   └── src/
    │       ├── agentResolver.ts # Agent 角色/能力匹配
    │       ├── intentClassifier.ts  # 消息意图分类（chat/task/goal）
    │       ├── goalAlignment.ts # 目标对齐
    │       ├── taskStateMachine.ts  # V2 10 态状态机校验
    │       └── contextPackageBuilder.ts  # Context Package 构建引擎
    ├── paseo-client/            # @crewden/paseo-client
    │   └── src/
    │       ├── paseo-daemon-client.ts  # Paseo WebSocket 协议
    │       ├── inbox-adapter.ts        # Inbox 适配器
    │       └── mcp-bridge/             # MCP 工具桥接
    ├── server/                  # @crewden/server
    │   └── src/
    │       ├── app.ts           # Fastify 启动
    │       ├── db.ts            # 数据库连接 + Store（Drizzle ORM）
    │       ├── schema.ts        # Drizzle schema 定义
    │       ├── events.ts        # 事件总线
    │       ├── repository/      # Repository 层（数据访问抽象）
    │       │   ├── types.ts
    │       │   ├── task.repository.ts
    │       │   ├── channel.repository.ts
    │       │   ├── message.repository.ts
    │       │   ├── thread.repository.ts
    │       │   ├── project.repository.ts
    │       │   └── contextPackageRef.repository.ts
    │       ├── routes/          # REST 路由
    │       │   ├── agents.ts / channels.ts / tasks.ts
    │       │   ├── threads.ts / messages.ts
    │       │   ├── decisions.ts / documents.ts
    │       │   ├── projects.ts / goals.ts / knowledge.ts
    │       │   ├── internalAgent.ts / machines.ts / audit.ts
    │       │   └── runtime.ts
    │       ├── runtime/         # Paseo 运行时集成
    │       │   ├── paseo-runtime-service.ts
    │       │   ├── delivery.ts / delivery-reliability.ts
    │       │   └── runtime-instance-mapper.ts
    │       └── ws/
    │           └── browserSocket.ts
    ├── cloudflare/              # @crewden/cloudflare
    │   └── src/
    │       ├── index.ts         # Worker 入口（路由 + DO 绑定）
    │       └── model.ts         # 数据模型
    └── web/                     # @crewden/web
        └── src/
            ├── App.tsx          # 主应用
            ├── api.ts           # HTTP/WS API 调用（独立维护类型）
            └── components/
                ├── Sidebar.tsx  / ChannelView.tsx / Composer.tsx
                ├── TaskBoard.tsx / ThreadPanel.tsx
                ├── AgentPanel.tsx / AgentDetailPanel.tsx
                ├── KnowledgePanel.tsx / InboxPanel.tsx
                ├── DecisionPanel.tsx / DocumentPanel.tsx
                └── ProjectSwitcher.tsx
```

---

## 4. 核心数据模型

### 4.1 所有对象使用 Polymorphic Actor

所有创建者/拥有者/审核者字段使用 `actorType` + `actorId` 替代旧版纯字符串：

```ts
type ActorRef = { actorType: 'human' | 'agent' | 'system'; actorId: string };
```

### 4.2 对象模型

| 对象 | 说明 | 事实源 | 状态 |
|---|---|---|---|
| Channel | 按项目隔离的讨论空间 | DB | — |
| Thread | 聚焦讨论的线程上下文 | DB | open / resolved |
| Message | 消息（带 actorType + intent 分类） | DB | — |
| Agent | 有角色/职责/权限/能力标签的团队成员 | DB | online / offline / working |
| Project | 多项目隔离边界 | DB | — |
| Task | 10 态执行契约（5 列看板映射） | Task Board | backlog → … → done |
| Decision | ADR 架构决策记录 | Docs | proposed → accepted → deprecated |
| Document | 6 种工程文档 | Docs | draft → in_review → approved → deprecated |
| Plan | Agent 执行前 Implementation Plan | Task Context | draft → submitted → approved → rejected |
| Approval | 高风险操作审批节点 | Audit | pending → approved → rejected → expired |
| ContextPackage | Agent 执行前生成的上下文包 | Task Context | — |
| AuditLog | 结构化审计记录 | Audit | — |

### 4.3 Task 10 态状态机

```
backlog → spec_needed → ready → assigned → in_progress
                                           → in_review
                                           → changes_requested → in_progress
                                           → qa → done
  任意状态 → cancelled
```

5 列看板映射：

| 看板列 | 包含状态 |
|---|---|
| Backlog | backlog, spec_needed |
| Todo | ready, assigned |
| In Progress | in_progress |
| Review | in_review, changes_requested, qa |
| Done | done |

---

## 5. 协议规范

### 5.1 REST API（Server / Cloudflare 对等）

```
# Channels
GET    /api/channels?projectId=
POST   /api/channels
GET    /api/channels/:id/messages
POST   /api/channels/:id/messages    body: { content, senderName, actorType, actorId, intent? }

# Threads
GET    /api/threads/:id
POST   /api/threads/:id/resolve
POST   /api/threads/:id/reopen
GET    /api/threads/:id/summary

# Tasks
GET    /api/tasks?projectId=&status=&assigneeId=
POST   /api/tasks
PATCH  /api/tasks/:id
POST   /api/tasks/:id/context-package

# Agents
GET    /api/agents?projectId=
POST   /api/agents
PATCH  /api/agents/:id

# Projects
GET    /api/projects
POST   /api/projects
DELETE  /api/projects/:id

# Decisions / Documents
GET    /api/decisions?projectId=
POST   /api/decisions
GET    /api/documents?projectId=
POST   /api/documents

# Knowledge / Goals / Audit / Machines / Internal Agent
GET    /api/knowledge?projectId=
GET    /api/goals?projectId=
GET    /api/audit?projectId=
GET    /api/machines
POST   /api/internal-agent/...
```

### 5.2 Browser WebSocket

连接端点：`ws://<host>/ws`

**Server → Browser（推送）：**

```ts
type BrowserEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'agent:update'; agent: Agent }
  | { type: 'task:update'; task: Task }
  | { type: 'machine:update'; machine: Machine };
```

### 5.3 Paseo Daemon 协议

Agent 生命周期通过 Paseo Client (`packages/paseo-client`) 管理，使用 Paseo Daemon 的 WebSocket 协议（持久会话 + Turn-based 执行）。详见 `packages/paseo-client/src/paseo-daemon-client.ts`。

MCP Bridge 在 Paseo 层暴露工具（`crewden_*` 前缀），Agent 可通过工具调用读写 Crewden API。

### 5.4 Internal Agent 协议

Server 端 Internal Agent 通过专用端点接收 delivery 和下发 inbox 消息，与 Paseo MCP Bridge 互补。

---

## 6. 关键设计决策

### 6.1 Cloudflare Worker + Durable Object (生产)

**原因：** 边缘部署低延迟，Durable Object 提供强一致性 SQLite 存储，零运维。Worker 和 DO 在同一 Cloudflare 网络内，访问延迟极低。

**取舍：** Cloudflare 与本地 Server 的 API 实现需要手动保持对等，不能自动同步。

### 6.2 SQLite via Drizzle ORM (本地开发)

**原因：** libsql client 支持本地文件 + 远程 Turso，Drizzle ORM 提供类型安全的 schema 定义和迁移。兼容 Node.js 24。

### 6.3 Paseo Runtime（替代旧 Daemon）

**原因：** Paseo 提供持久会话 + Turn-based 执行，上下文在各 turn 间保持。比旧的 one-shot 进程模式更高效，且支持多 runtime（claude/codex/gemini/pi）。

### 6.4 hub-core 共享业务逻辑

**原因：** Server 和 Cloudflare 对等实现，需要共享核心业务逻辑（状态机校验、Agent 匹配、意图分类）。hub-core 只依赖 shared，不依赖任何基础设施。

### 6.5 Repository 层（v2.4.1 引入）

**原因：** 将数据访问从 `db.ts` 中提取到独立 Repository 类，改善可测试性和可维护性。目前为具体类（非接口），按需逐步抽象。

### 6.6 ContextPackage 失效机制

**原因：** Agent 执行必须有新鲜上下文。当关联的 document/decision 更新或 parent task 完成时，系统自动标记 contextPackage 为 stale，Agent 拉取时自动重新生成。

### 6.7 Web 端类型独立

**原因：** Web 是纯前端 SPA，不依赖 `@crewden/shared` 运行时。类型在 `web/src/api.ts` 中独立维护。计划在 v2.5 引入 shared 为 devDependency 做类型校验。

---

## 7. 开发规范

### 7.1 分支工作流

```
main → feat/<name> → 实现 → verify → merge --no-ff → main → push
```

详见 `AGENTS.md` 中的完整规范。

### 7.2 提交前检查

```bash
pnpm verify                                     # typecheck + 全量测试
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
```

### 7.3 测试策略

- **单元测试**：hub-core 业务逻辑（stateMachine、intentClassifier、agentResolver、contextPackageBuilder）
- **Repository 测试**：server repository 层
- **API 集成测试**：server routes（共享 DB 实例）
- **Cloudflare 测试**：`wrangler deploy --dry-run` + Miniflare 本地模拟

### 7.4 新增功能流程

1. 在 `shared/src/protocol.ts` 定义类型
2. 在 `shared/src/validation.ts` 添加 Zod schema
3. 如涉及共享业务逻辑，在 `hub-core/src/` 实现
4. 在 `server/src/schema.ts` 添加 DB 表定义
5. 在 `server/src/repository/` 添加 Repository（不要追加到 `db.ts` 末尾）
6. 在 `server/src/routes/` 添加路由
7. 在 `cloudflare/src/index.ts` 添加 Cloudflare 对等实现
8. 在 `web/src/api.ts` 添加前端类型和 API 调用
9. 补充对应测试

---

## 8. 迭代路线（v2.x 当前）

| 版本 | 主题 | 依赖 | 状态 |
|------|------|------|------|
| v2.0 | Polymorphic Actor + Task Contract | v1.5.1 | ✅ 完成 |
| v2.1 | Agent Identity v2 | v2.0 | ✅ 完成 |
| v2.2 | Decision & Document | v2.0 | ✅ 完成 |
| v2.2.1 | Project 多项目隔离 | v2.2 | ✅ 完成 |
| v2.3 | Thread Intelligence | v2.2.1 | ✅ 完成 |
| v2.4 | Context Package Engine | v2.3 | ✅ 完成 |
| v2.4.1 | Code Hardening & Context Freshness | v2.4 | ✅ 完成 |
| v2.5 | Plan & Approval Gate | v2.4.1 | ⏳ 规划中 |
| v2.6 | Code Execution & Review | v2.5 | 📋 草稿 |
| v2.7 | Autopilot Engine | v2.0 | 📋 草稿 |
| v2.8 | Knowledge Layer | v2.6 | 📋 草稿 |
| v2.9 | Full Trace & Audit | v2.5 | 📋 草稿 |
| v2.10 | Self-Evolution | v2.8+v2.9 | 📋 草稿 |

完整路线图见 [ROADMAP.md](./ROADMAP.md) 和 [ROADMAP_V2.md](./slack/ROADMAP_V2.md)。

---

## 9. 本地开发快速启动

```bash
# 安装依赖
pnpm install

# 启动开发服务（server + web）
pnpm dev

# 验证
pnpm verify

# Cloudflare 本地模拟（需要 wrangler）
pnpm --filter @crewden/cloudflare dev
```

**环境要求：**
- Node.js 20+（已在 24 上验证）
- pnpm 8+
- Paseo Daemon（提供 Agent runtime）

---

## 10. 目录速查

| 路径 | 说明 |
|------|------|
| `packages/shared/src/protocol.ts` | 所有 TypeScript 类型定义 |
| `packages/shared/src/validation.ts` | Zod schema |
| `packages/hub-core/src/` | 共享业务逻辑（状态机/Agent匹配/意图分类） |
| `packages/server/src/db.ts` | SQLite 连接 + Store（Drizzle ORM） |
| `packages/server/src/schema.ts` | Drizzle schema 定义 |
| `packages/server/src/repository/` | Repository 层（数据访问抽象） |
| `packages/server/src/routes/` | REST API 路由 |
| `packages/server/src/runtime/` | Paseo 运行时集成 |
| `packages/paseo-client/src/` | Paseo Daemon WebSocket 协议 |
| `packages/cloudflare/src/index.ts` | Cloudflare Worker 入口 |
| `packages/web/src/api.ts` | 前端 API 调用 + 类型定义 |
| `packages/web/src/components/` | React 组件 |
| `docs/slack/SLACK_LIKE_AI_AGENT_DESIGN.md` | v2.x 完整设计文档 |
| `docs/slack/ROADMAP_V2.md` | v2.x 详细版本规划 |
