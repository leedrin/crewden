# Phase 0 环境准备完成报告

> 日期：2026-05-04
> 状态：✅ 已完成
> 下一阶段：Phase 0 核心开发 — Paseo 客户端 SDK 抽取与 PoC 验证

---

## 一、工作总览

### 1.1 完成事项

| #   | 事项                                       | 状态 | 说明                             |
| --- | ------------------------------------------ | ---- | -------------------------------- |
| 1   | Crewden 代码架构分析                       | ✅   | 深入分析 6 个包、28+ 核心源文件  |
| 2   | Paseo × Crewden 整合方案可行性评审         | ✅   | 识别 6 项关键风险，修订 9 处方案 |
| 3   | 详细功能设计方案                           | ✅   | 修订为 5 阶段 14 周计划          |
| 4   | Paseo 仓库 `feat/crewden-integration` 分支 | ✅   | 设计文档已提交                   |
| 5   | Crewden 仓库 `feat/paseo-integration` 分支 | ✅   | 包骨架已提交                     |
| 6   | `packages/paseo-client` 包骨架             | ✅   | 6 个模块 + 11 个测试             |

### 1.2 未完成事项（留待 Phase 0 核心）

| #   | 事项                       | 说明                                                  |
| --- | -------------------------- | ----------------------------------------------------- |
| 1   | Paseo 客户端 SDK 抽取      | 从 `packages/server/src/client/` 抽取为独立可复用模块 |
| 2   | PaseoDaemonClient 真实连接 | 替换 TODO 占位符，实现 WebSocket 二进制协议连接       |
| 3   | PoC 验证脚本               | 连接 Paseo Daemon → 创建 Agent → 发送消息 → 接收回复  |
| 4   | 可行性验证报告             | 基于实际运行结果输出报告                              |

---

## 二、仓库状态

### 2.1 Paseo 仓库

- **仓库**：`/Users/lijun/Documents/paseo`
- **分支**：`feat/crewden-integration`
- **远程**：`origin → github.com/leedrin/paseo.git`，`upstream → github.com/getpaseo/paseo.git`
- **提交**：

```
3c0a53f1 docs: add Crewden integration feasibility review and detailed design
28457e0c docs: add Crewden integration plan
```

- **新增文件**：
  - `docs/CREWDEN_INTEGRATION.md` — 修订后的整合方案
  - `docs/CREWDEN_INTEGRATION_DESIGN.md` — 详细功能设计方案

### 2.2 Crewden 仓库

- **仓库**：`/Users/lijun/Documents/crewden`
- **分支**：`feat/paseo-integration`
- **远程**：`origin → github.com/leedrin/crewden.git`，`upstream → github.com/xlvecle/crewden.git`
- **提交**：

```
05c9144 feat(paseo-client): add package skeleton for Paseo integration Phase 0
```

- **新增文件**：
  - `packages/paseo-client/package.json`
  - `packages/paseo-client/tsconfig.json`
  - `packages/paseo-client/vitest.config.ts`
  - `packages/paseo-client/src/index.ts`
  - `packages/paseo-client/src/types.ts`
  - `packages/paseo-client/src/paseo-daemon-client.ts`
  - `packages/paseo-client/src/inbox-adapter.ts`
  - `packages/paseo-client/src/timeline-to-event-bridge.ts`
  - `packages/paseo-client/src/crewden-context-injector.ts`
  - `packages/paseo-client/src/runtime-mapper.ts`
  - `packages/paseo-client/test/paseo-client.test.ts`

---

## 三、`packages/paseo-client` 包骨架详情

### 3.1 模块清单

| 模块          | 文件                              | 职责                                                    | 状态                  |
| ------------- | --------------------------------- | ------------------------------------------------------- | --------------------- |
| 类型定义      | `src/types.ts`                    | 共享类型：事件、连接状态、MCP 配置、Agent 快照          | ✅ 完成               |
| Paseo 连接    | `src/paseo-daemon-client.ts`      | 连接管理、Agent 创建/发送/停止、stream 订阅、自动重连   | 🔧 骨架（SDK 待接入） |
| Inbox 适配    | `src/inbox-adapter.ts`            | 消息队列管理、idle 触发投递、并发保护                   | ✅ 完成               |
| Timeline 桥接 | `src/timeline-to-event-bridge.ts` | Paseo stream → Crewden 事件映射、文本累积、工具调用检测 | ✅ 完成               |
| 上下文注入    | `src/crewden-context-injector.ts` | 投递消息格式化、MCP 配置生成、system prompt 附加        | ✅ 完成               |
| Runtime 映射  | `src/runtime-mapper.ts`           | Crewden RuntimeId ↔ Paseo Provider 映射                 | ✅ 完成               |
| 包入口        | `src/index.ts`                    | 统一导出                                                | ✅ 完成               |

### 3.2 测试覆盖

```
 ✓ test/paseo-client.test.ts (11 tests) 13ms

   InboxAdapter
     ✅ delivers immediately when agent is idle
     ✅ queues messages when agent is busy

   TimelineToEventBridge
     ✅ accumulates text and emits message on run_finished
     ✅ detects crewden tool calls
     ✅ detects mcp__crewden__ prefixed tools

   CrewdenContextInjector
     ✅ builds deliver prompt with inbox summary
     ✅ builds MCP config with stdio transport

   runtime-mapper
     ✅ maps claude to claude-code
     ✅ maps codex to codex
     ✅ throws for gemini
     ✅ supportsRuntime returns correct values
```

### 3.3 全仓库验证

```
packages/shared     typecheck ✅
packages/paseo-client typecheck ✅
packages/daemon     typecheck ✅
packages/hub-core   typecheck ✅
packages/server     typecheck ✅
packages/cloudflare typecheck ✅
packages/web        typecheck ✅
```

---

## 四、关键设计决策

### 4.1 两仓库保持独立

Paseo 和 Crewden 是独立 Git 仓库（不同 GitHub org）。集成通过 npm 依赖（`@getpaseo/client-sdk`）实现，不合并仓库。

### 4.2 渐进替换策略

引入 `AgentRuntimeBridge` 抽象层，支持 `local-daemon`（现有）和 `paseo-daemon`（新增）两种模式并存。不一步删除 `packages/daemon`。

### 4.3 MCP Bridge 复用

现有 `packages/daemon/src/mcp/bridge.ts` 提取为独立可执行文件，作为 MCP Server 注入 Paseo Agent。不重写，仅迁移。

### 4.4 工具分批交付

- Phase 2：12 个核心工具（对齐现有 MCP bridge）
- Phase 3：扩展到 22 个（claim_task, knowledge, goals, reviews 等）

---

## 五、风险跟踪

| 风险                       | 当前状态    | 下一步                     |
| -------------------------- | ----------- | -------------------------- |
| Paseo 客户端 SDK 抽取复杂  | 🟡 待验证   | Phase 0 核心验证           |
| Paseo 二进制协议适配       | 🟡 待验证   | Phase 0 核心验证           |
| Inbox 队列 turn-based 适配 | 🟢 已有实现 | PoC 中验证                 |
| Gemini runtime 不支持      | 🟢 已明确   | UI 提示用户切换 local 模式 |
| 14 周工期估算准确性        | 🟡 待验证   | Phase 0 完成后校准         |

---

## 六、Phase 0 核心阶段计划

### 目标

验证 Paseo 客户端协议栈可从 Node.js 服务端连接，完成最小闭环。

### 任务清单

| #   | 任务                                                               | 优先级 | 预计耗时 |
| --- | ------------------------------------------------------------------ | ------ | -------- |
| 1   | 分析 Paseo `packages/server/src/client/` 依赖树，确定 SDK 抽取边界 | 高     | 2h       |
| 2   | 抽取客户端核心模块为 `@getpaseo/client-sdk`（或直接 import）       | 高     | 1-2 天   |
| 3   | 实现 `PaseoDaemonClient.connect()` 真实连接                        | 高     | 4h       |
| 4   | 实现 `PaseoDaemonClient.createAgent()`                             | 高     | 4h       |
| 5   | 实现 `PaseoDaemonClient.sendMessage()`                             | 高     | 2h       |
| 6   | 实现 stream 事件订阅与分发                                         | 高     | 4h       |
| 7   | 编写 PoC 脚本验证完整闭环                                          | 高     | 2h       |
| 8   | 输出 Paseo 客户端协议适配可行性报告                                | 中     | 2h       |

### 验收标准

- [ ] Node.js 脚本成功连接本地 Paseo Daemon
- [ ] 创建 Claude/Codex agent 成功
- [ ] 发送消息并收到回复
- [ ] stream 事件实时接收
- [ ] 断线自动重连验证
