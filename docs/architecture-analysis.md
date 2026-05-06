# Crewden 架构分析报告

> 日期：2026-05-06
> 代码库分析范围：packages/ 下 6 个子包（shared、hub-core、paseo-client、server、cloudflare、web）

---

## 一、包依赖关系图

```mermaid
graph TB
    subgraph "UI 层"
        WEB["@crewden/web<br/>React + Vite<br/>独立 SPA"]
    end

    subgraph "接口适配层"
        SERVER["@crewden/server<br/>Fastify + WebSocket<br/>REST API + 路由"]
        CF["@crewden/cloudflare<br/>Cloudflare Worker<br/>Durable Object + SQLite"]
    end

    subgraph "用例层"
        HC["@crewden/hub-core<br/>共享业务逻辑<br/>Agent 解析 / 意图分类 / Goal 对齐"]
    end

    subgraph "基础设施层"
        PC["@crewden/paseo-client<br/>Paseo Daemon 适配器<br/>WebSocket 客户端 + MCP Bridge"]
    end

    subgraph "领域层"
        SHARED["@crewden/shared<br/>协议类型 / Zod Schema<br/>版本号"]
    end

    WEB -->|"HTTP REST + WebSocket"| SERVER
    WEB -.->|"HTTP REST + WebSocket<br/>(生产环境)"| CF

    SERVER --> HC
    SERVER --> PC
    SERVER --> SHARED

    CF --> HC
    CF --> SHARED

    HC --> SHARED
    PC --> SHARED
```

**依赖方向**：所有箭头指向 `shared`（最底层），无一反向依赖。

实际 `package.json` 验证：

| 包 | 依赖的内部包 |
|---|---|
| `shared` | 无 |
| `hub-core` | `shared` |
| `paseo-client` | `shared` |
| `server` | `shared`, `hub-core`, `paseo-client` |
| `cloudflare` | `shared`, `hub-core` |
| `web` | **无内部包依赖**（独立 SPA，通过 HTTP/WS 与后端通信） |

---

## 二、运行时数据流图

```mermaid
sequenceDiagram
    actor User as 👤 用户
    participant Web as Web UI<br/>(React SPA)
    participant CF as Cloudflare Worker<br/>(crewden-hub)
    participant DO as Durable Object<br/>(SQLite)
    participant Server as Node Server<br/>(Fastify)
    participant PC as Paseo Client<br/>(paseo-client)
    participant PD as Paseo Daemon
    participant Agent as Agent CLI<br/>(claude/codex/pi...)

    Note over User,Agent: === 消息发送 → Agent 回复全链路 ===

    User->>Web: 在 Channel 中发送消息
    Web->>CF: POST /api/channels/:id/messages
    CF->>DO: 写入 message 表
    CF->>Server: WebSocket 推送 message:new

    Note over Server: Server 检测到消息 @提及 Agent
    Server->>DO: 写入 agent_task_queue
    Server->>PC: deliverMessage(agentId, delivery)
    PC->>PD: sendMessage(paseoAgentId, prompt)
    PD->>Agent: 注入 context + 启动 Agent CLI
    Agent->>PD: stdout (thinking/working/output)
    PD->>PC: stream events
    PC->>Server: AgentMessageEvent
    Server->>DO: 写入 message (actorType=agent)
    Server->>CF: WebSocket 推送 message:new
    CF->>Web: 实时推送消息
    Web->>User: 显示 Agent 回复

    Note over User,Agent: === Task Board 数据流 ===

    User->>Web: 创建 Task / 变更状态
    Web->>CF: POST/PATCH /api/tasks
    CF->>DO: 写入 task 表 + audit_log
    CF->>Web: 推送 task:update

    Note over User,Agent: === Autopilot 数据流 (v2.7) ===

    CF->>CF: Durable Object Alarm 触发
    CF->>DO: 扫描 autopilot_triggers
    CF->>DO: 创建 autopilot_run + issue
    CF->>Server: 推送事件
    Server->>PC: 投递 task 给 agent
```

### 关键数据流决策

1. **Cloudflare 是单一数据源** — 所有持久化数据的读写都走 Cloudflare Worker → Durable Object SQLite
2. **Server 不直接写本地 DB** — 本地 `better-sqlite3` 仅用于迁移/开发，生产环境通过 Cloudflare API 操作数据
3. **Web 是纯前端** — 不依赖任何 `@crewden/*` 包，TypeScript 类型需在 Web 侧独立维护
4. **消息推送链路**：Agent → Paseo Daemon → Paseo Client → Server → Cloudflare → Web

---

## 三、分层架构评估

### 3.1 分层映射

```mermaid
graph TB
    subgraph "表示层 Presentation"
        WEB_LAYER["@crewden/web"]
    end

    subgraph "接口适配层 Interface Adapters"
        SERVER_ROUTES["server/routes/*<br/>REST 端点 + 鉴权"]
        CF_ROUTES["cloudflare/src/index.ts<br/>Worker 路由"]
    end

    subgraph "用例层 Use Cases"
        HC_LAYER["@crewden/hub-core<br/>agentResolver / goalAlignment<br/>intentClassifier"]
    end

    subgraph "基础设施层 Infrastructure"
        DB["server/db.ts<br/>2200+ 行 Drizzle ORM"]
        PC_LAYER["@crewden/paseo-client<br/>Paseo WebSocket 协议"]
        CF_DO["Durable Object<br/>SQLite 存储"]
    end

    subgraph "领域层 Domain"
        SHARED_LAYER["@crewden/shared<br/>protocol.ts / validation.ts<br/>纯类型 + Zod Schema"]
    end

    WEB_LAYER --> SERVER_ROUTES
    WEB_LAYER -.-> CF_ROUTES
    SERVER_ROUTES --> HC_LAYER
    SERVER_ROUTES --> DB["server/db.ts"]
    SERVER_ROUTES --> PC_LAYER
    CF_ROUTES --> HC_LAYER
    CF_ROUTES --> CF_DO
    HC_LAYER --> SHARED_LAYER
    DB --> SHARED_LAYER
    PC_LAYER --> SHARED_LAYER
    CF_DO --> SHARED_LAYER
```

### 3.2 分层合规评估

| Clean Architecture 原则 | 当前状态 | 评估 |
|---|---|---|
| **领域层无外部依赖** | `shared` 零内部依赖，纯类型定义 | ✅ 符合 |
| **用例层只依赖领域层** | `hub-core` 只依赖 `shared` | ✅ 符合 |
| **适配层只依赖用例层 + 基础设施** | `server` 依赖 `shared` + `hub-core` + `paseo-client` | ✅ 符合 |
| **基础设施层只依赖领域层** | `paseo-client` 只依赖 `shared` | ✅ 符合 |
| **表示层独立** | `web` 无任何 `@crewden/*` 依赖 | ✅ 符合 |
| **server 与 cloudflare 对等** | 两端各自实现路由，共享 `hub-core` 业务逻辑 | ✅ 符合 |

### 3.3 存在的架构问题

#### 问题 1：`server/db.ts` 是 God File

```
packages/server/src/db.ts — 2200+ 行
├── 数据访问（SQL）
├── 业务规则（状态校验）
├── 消息处理（classifyMessageIntent 调用）
├── Agent 生命周期
└── 事务管理
```

**违反原则**：单一职责。DB 操作、业务规则、Agent 管理混在一个文件中。

**建议**：拆分为 Repository 层（纯数据访问）+ Service 层（业务编排）。

```
packages/server/src/
├── db/
│   ├── repository/
│   │   ├── channel.repository.ts    ← 纯 SQL
│   │   ├── task.repository.ts
│   │   └── ...
│   └── db.ts                       ← 连接管理 + 迁移
├── service/
│   ├── task.service.ts             ← 业务规则 + 状态机
│   ├── agent.service.ts
│   └── ...
└── routes/
    └── tasks.ts                    ← HTTP 适配 + 鉴权
```

#### 问题 2：`hub-core` 过薄

当前 `hub-core` 只有 7 个模块（agent、goalAlignment、intentClassifier、machine、message），大部分业务逻辑仍在 `server/db.ts` 中实现，没有提取到 `hub-core`。

**影响**：`server` 和 `cloudflare` 各自在 `db.ts` 和 `index.ts` 中重复实现了相似逻辑（task 状态校验、消息投递、Agent 委派等）。

**建议**：将 task 状态机、消息路由、Agent 委派等核心业务规则提取到 `hub-core`，两端只做 HTTP 适配。

#### 问题 3：Web 端类型孤立

`web` 不依赖 `@crewden/shared`，意味着前端需要自己维护 API 返回数据的类型定义。如果 `shared` 中的类型变更，Web 端不会获得 TypeScript 编译期反馈。

**建议**：让 `web` 声明 `@crewden/shared` 为 devDependency（仅类型引用，不增加运行时体积），或生成 OpenAPI schema 从 `shared` 类型自动推导。

#### 问题 4：无 Repository 抽象层

`server/routes/*.ts` 直接调用 `db.ts` 中的函数（如 `getOrCreateDb().createMessage(...)`），没有通过接口抽象。如果需要替换存储后端（如从 SQLite 迁移到 PostgreSQL），需要修改所有 route 文件。

**建议**：引入 Repository 接口，route 依赖接口而非具体实现。

---

## 四、建议的架构优化方案

### 4.1 目标架构

```mermaid
graph TB
    subgraph "表示层 Presentation"
        WEB["@crewden/web<br/>独立 SPA<br/>devDep @crewden/shared (types)"]
    end

    subgraph "接口适配层 Interface Adapters"
        subgraph "server/routes"
            SR["channels.ts / tasks.ts / agents.ts / ..."]
        end
        subgraph "cloudflare/src"
            CF["index.ts (Worker)"]
        end
    end

    subgraph "应用层 Application (use cases)"
        subgraph "@crewden/hub-core 扩展后"
            TS["task.service.ts<br/>状态机 / 状态校验 / 依赖检查"]
            AS["agent.service.ts<br/>Agent 匹配 / 委派 / 权限"]
            MS["message.service.ts<br/>消息路由 / 意图分类"]
            GS["goal.service.ts<br/>目标对齐 / 拆解"]
            KS["knowledge.service.ts<br/>知识检索 / 卫生"]
            APS["autopilot.service.ts<br/>调度 / dispatch / 生命周期"]
        end
    end

    subgraph "基础设施层 Infrastructure"
        subgraph "Repository 接口"
            RI["IRepository<br/>定义数据访问契约"]
        end
        subgraph "Repository 实现"
            SRP["SqliteRepository<br/>better-sqlite3 + Drizzle"]
            CFRP["D1Repository<br/>Cloudflare Durable Object"]
        end
        PC["@crewden/paseo-client<br/>Paseo 协议适配"]
    end

    subgraph "领域层 Domain"
        SH["@crewden/shared<br/>类型 / Schema / 常量"]
    end

    WEB -->|HTTP/WS| SR
    WEB -.->|HTTP/WS| CF
    SR --> TS & AS & MS & GS & KS & APS
    CF --> TS & AS & MS & GS & KS & APS
    TS & AS & MS & GS & KS & APS --> RI
    RI -.-> SRP
    RI -.-> CFRP
    TS & AS & MS & GS & KS & APS --> PC
    TS & AS & MS & GS & KS & APS --> SH
    RI --> SH
    PC --> SH
```

### 4.2 改造优先级

| 优先级 | 改造项 | 影响范围 | 预估工作量 |
|---|---|---|---|
| P0 | 拆分 `server/db.ts` → Repository + Service | server 全部路由 | 大 |
| P1 | 扩展 `hub-core`，提取 task 状态机、Agent 委派、消息路由等 | server + cloudflare | 中 |
| P1 | 定义 Repository 接口 | server + cloudflare | 小 |
| P2 | Web 端引入 `@crewden/shared` 类型 | web | 小 |
| P3 | 两端 Repository 实现（SQLite + Durable Object） | server + cloudflare | 大 |

---

## 五、总结

### 5.1 当前架构评分

| 维度 | 评分 | 说明 |
|---|---|---|
| **分层清晰度** | ⭐⭐⭐⭐ | 6 个包职责分明，依赖方向正确 |
| **单向依赖** | ⭐⭐⭐⭐⭐ | 所有箭头指向 `shared`，零反向依赖 |
| **关注点分离** | ⭐⭐⭐ | routes 和 DB 分离，但 db.ts 过重 |
| **可测试性** | ⭐⭐⭐ | 无 Repository 接口，难以 mock 数据层 |
| **可扩展性** | ⭐⭐⭐⭐ | 新增功能只需加 route + DB 函数，模式统一 |
| **可维护性** | ⭐⭐⭐ | db.ts 2200 行将是长期维护负担 |

### 5.2 结论

Crewden 的包级依赖架构**符合整洁架构的分层原则**——领域层在最底层，用例层居中，适配层在上，表示层独立。依赖方向严格单向，无循环引用。

但在**模块内聚**层面存在改进空间：`server/db.ts` 是 God File，`hub-core` 过薄导致两端有重复实现。建议在后续迭代中逐步将业务逻辑提取到 `hub-core`，并引入 Repository 接口抽象数据访问层。
