# MultiCa 作为 Crewden V2.0 任务看板/任务系统 —— 可行性调研报告

> **方案**：方案 B — 提取 MultiCa Autopilot + Task Schema 设计参考
>
> 不部署 MultiCa，不引入 Go 运行时。从 MultiCa 的 Autopilot 引擎和 Task 数据模型中提取设计蓝图，在 Crewden 的 TypeScript + Paseo 架构中自主实现。
>
> 日期：2026-05-06

---

## 目录

1. [一、执行摘要](#一执行摘要)
2. [二、能力映射矩阵](#二能力映射矩阵)
3. [三、深度对比分析](#三深度对比分析)
4. [四、架构差异分析](#四架构差异分析)
5. [五、集成方案](#五集成方案)
6. [六、推荐路径](#六推荐路径)
7. [七、具体可行性评估](#七具体可行性评估)
8. [八、风险与缓解](#八风险与缓解)
9. [九、结论](#九结论)

---

## 一、执行摘要

**结论：技术上高度可行。** MultiCa 在生产环境已有的 Polymorphic Actor 模型、7 态任务状态机、Autopilot 引擎、Skill 系统、Inbox 通知、Activity Log 等，恰好覆盖 Crewden V2.0 计划中 **v2.0、v2.1、v2.7 三个版本的核心交付**。通过提取设计参考，这三个版本的工作量可从"从零构建"变为"参考成熟设计后自主实现"，预计总体节省约 20% 的开发时间。

其中 **v2.7 Autopilot 是最大收益点**：MultiCa 的 Autopilot 核心算法（Dispatch、调度、生命周期联动）与语言无关，约 80% 的设计语义可参考并在 TypeScript/SQLite/Cloudflare 约束下重新实现，预计节省约 55% 的开发时间。

但 MultiCa 与 Crewden 在 **技术栈**（Go+PostgreSQL vs TypeScript+SQLite）、**运行时模型**（自有 daemon vs Paseo）和 **协作范式**（issue-centric vs channel-centric）上存在根本差异，代码不可直接移植，只能作为设计蓝图。

---

## 二、能力映射矩阵

### 2.1 Crewden V2.x 各版本 vs MultiCa 已有能力

| Crewden 版本 | 核心交付 | MultiCa 对应 | 覆盖度 |
|---|---|---|---|
| **v2.0** | Polymorphic Actor + 10态状态机 | ✅ `assignee_type`/`creator_type`/`actor_type` 贯穿所有表；7态 issue 状态机 | **85%** |
| **v2.1** | Agent Identity v2 + 权限 | ✅ agent 完整配置（provider、instructions、env、MCP、skills、visibility）| **70%** |
| **v2.2** | Decision & Document | ❌ MultiCa 无 ADR/Document 概念 | 0% |
| **v2.3** | Thread Intelligence + Inbox | ✅ Inbox（subscription/member+agent/push）；⚠️ 无 Thread 摘要 | **50%** |
| **v2.4** | Context Package | ❌ MultiCa 无 Context Package | 0% |
| **v2.5** | Plan & Approval | ❌ MultiCa 无 Plan/Approval 对象 | 0% |
| **v2.6** | Code Execution (Git) | ✅ daemon 内置 git clone/checkout；⚠️ 不走 Paseo | **40%** |
| **v2.7** | Autopilot | ✅ **完全覆盖**：schedule/webhook/API 触发、create_issue/run_only、并发策略、6+ 内置模板 | **95%** |
| **v2.8** | Knowledge Layer | ⚠️ Skill 系统（静态文档注入）；无 scope 分层 | **35%** |
| **v2.9** | Full Trace | ⚠️ activity_log + task_message；无 span-based | **30%** |
| **v2.10** | Self-Evolution | ❌ 无自动学习机制 | 0% |

### 2.2 能力重叠热图

```
High overlap (设计参考价值高):
  v2.0 Polymorphic Actor   ████████████████  85%
  v2.7 Autopilot           ████████████████  95%

Medium overlap (可参考):
  v2.1 Agent Identity      ██████████░░░░░░  70%
  v2.3 Thread/Inbox        ██████████░░░░░░  50%
  v2.6 Code Execution      ████████░░░░░░░░  40%

Low overlap (需从零设计):
  v2.2 Decision/Document   ░░░░░░░░░░░░░░░░   0%
  v2.4 Context Package     ░░░░░░░░░░░░░░░░   0%
  v2.5 Plan/Approval       ░░░░░░░░░░░░░░░░   0%
  v2.8 Knowledge Layer     ██████░░░░░░░░░░  35%
  v2.9 Full Trace          ██████░░░░░░░░░░  30%
  v2.10 Self-Evolution     ░░░░░░░░░░░░░░░░   0%
```

---

## 三、深度对比分析

### 3.1 Polymorphic Actor 模型

**MultiCa（已生产）：**
```sql
-- 所有"谁做了"字段统一为 type + id 对
issue.assignee_type + issue.assignee_id    -- 'member' | 'agent'
issue.creator_type  + issue.creator_id
comment.author_type + comment.author_id
inbox_item.recipient_type + recipient_id
activity_log.actor_type + actor_id
```

**Crewden V2.0 计划：**
```ts
type Actor = { actorType: 'human' | 'agent' | 'system'; actorId: string; }
```

评估：MultiCa 的模型**更成熟**——28 张表全部使用 Polymorphic Actor，包括 inbox recipient 也同时支持 member 和 agent。Crewden 的 V2.0 可以从 MultiCa 的设计中直接借鉴 schema 甚至迁移策略。

### 3.2 任务状态机

| 维度 | MultiCa Issue | Crewden V2.0 Task |
|---|---|---|
| 状态数量 | 7 态 | 10 态 |
| 状态列表 | backlog, todo, in_progress, in_review, done, blocked, cancelled | backlog, spec_needed, ready, assigned, in_progress, in_review, changes_requested, qa, done, cancelled |
| blocked 语义 | 独立列 | 子标记（isBlocked + blockedReason） |
| 依赖 | issue_dependency 表（blocks/blocked_by/related）| dependsOn JSON array |
| 乐观锁 | 无 | version 字段 CAS |
| 位置排序 | position FLOAT（支持拖拽） | 无 |
| 看板列 | 7 列 | 5 列（收敛多个数据态） |

评估：Crewden V2.0 的状态设计**更精细**（10 态 vs 7 态），但 MultiCa 的看板 UI（拖拽排序、列管理）**更成熟**。两者差异是可调和的。

### 3.3 Autopilot

这是 MultiCa 对 Crewden V2.7 **近乎完美的先验实现**：

| 维度 | MultiCa | Crewden V2.7 计划 |
|---|---|---|
| Schedule 触发 | ✅ cron + timezone | ✅ cron + timezone |
| Webhook 触发 | ✅ webhook_token | ✅ webhook_secret |
| Event 触发 | ❌ | ✅ event_type |
| 执行模式 | create_issue / run_only | create_task / send_message |
| 并发策略 | skip / queue / replace | skip / queue / replace |
| 内置模板 | 6 个 | 4 个 |
| 运行记录 | autopilot_run 表 | autopilot_runs 表 |
| assignee 解析 | 直接 agent_id | agent_id / role 匹配 |
| 追溯链 | issue.origin_type='autopilot' | result_task_id |

评估：MultiCa 的 Autopilot **设计语义可直接参考**，仅缺少 Event 触发和 role-based assignee 解析。具体实现需在 TypeScript/SQLite/Cloudflare 约束下重新编写，不得复制 Go 代码。

### 3.4 Skill 系统

| 维度 | MultiCa | Crewden V2.8/V2.10 计划 |
|---|---|---|
| 形态 | 静态 Markdown 文档 | Knowledge Entry（动态检索） |
| 注入方式 | 写入 agent CLI 工作目录 | Context Package 中注入摘要 |
| 生命周期 | 无状态机 | draft → verified → deprecated |
| 来源 | 手动创建 / URL 导入 | 手动 + Task 自动沉淀 |
| 适用范围 | 挂载到 agent | 按 role/capability 匹配 |

评估：MultiCa 的 Skill 是**静态知识注入**，Crewden 计划的是**动态知识检索 + 自进化**。两者互补，不是替代关系。

## 四、架构差异分析

### 4.1 技术栈断裂

| 维度 | Crewden | MultiCa |
|---|---|---|
| 后端语言 | TypeScript (Node.js) | Go |
| 数据库 | SQLite (better-sqlite3) | PostgreSQL 17 + pgvector |
| 前端 | React / Vite | Next.js 16 (App Router) |
| 实时通信 | ws WebSocket | gorilla/websocket |
| 部署 | Cloudflare Workers + Pages | Docker / Self-host |
| 包管理 | pnpm workspaces | pnpm workspaces + Turborepo |

**结论**：两个项目技术栈完全不重叠。代码不可直接移植，仅可作为设计参考。

### 4.2 运行时模型差异

```
Crewden:
  Crewden Server → Paseo Daemon → Claude/Codex/Pi CLI
  （Paseo 是唯一 Runtime，Crewden daemon 已退役）

MultiCa:
  MultiCa Server → MultiCa Daemon → Claude/Codex/OpenCode/... CLI
  （MultiCa 自有 daemon，每 3s 轮询任务、15s 心跳）
```

**结论**：两个项目在 Runtime 层有根本性冲突。Crewden 已经完成了 Paseo 单栈收敛（投入了大量工程资源），不能回头引入 MultiCa daemon。

### 4.3 协作范式差异

```
Crewden:  Channel → Thread → Message → Task
         （聊天优先，任务从讨论中产生）

MultiCa:  Issue → Comment → Agent Task
         （任务优先，讨论围绕 issue 展开）
```

**结论**：Crewden 的 Channel/Thread 是 MultiCa 不具备的核心差异化能力。这是 V2.0「Slack-like」愿景的基石，不应替换。

---

## 五、集成方案

### 方案 B：提取 MultiCa 设计参考（选定）

不部署 MultiCa，不引入 Go 运行时。纯从 MultiCa 的成熟实现中提取设计蓝图——包括数据模型、状态机、调度算法、生命周期管理——在 Crewden 的 TypeScript + Paseo 架构中自主实现。

**具体做法**：

1. **数据模型层面**：参考 MultiCa 的表结构（DDL）、字段命名规范、CHECK 约束、索引策略，在 Crewden 的 SQLite schema 中重新实现
2. **业务逻辑层面**：翻译 MultiCa 的 Go 核心算法（DispatchAutopilot、ComputeNextRun、SyncRunFromIssue）为 TypeScript
3. **UI 层面**：参考 MultiCa 的看板设计哲学（kanban + list 双视图、拖拽排序、筛选），在 Crewden 的 React 组件中重新实现

**优势**：
- 架构干净，单一 TypeScript 技术栈
- 不引入外部运行时依赖
- 完全自主可控
- Paseo 作为唯一 Runtime 不变

**劣势**：
- 无法直接复用 MultiCa 的成熟代码和测试
- 开发量最大
- 需要阅读 Go 代码并翻译为 TypeScript

---

## 六、推荐路径

```
Phase 1（v2.0-v2.1，基础建设）
  ├─ 参考 MultiCa 的 Polymorphic Actor 字段设计 → Crewden 自主实现
  ├─ 参考 MultiCa 的 issue 状态机 → 扩展为 Crewden 的 10 态
  └─ 参考 MultiCa 的 activity_log 模式 → 实现 Crewden 的 audit_log

Phase 2（v2.3-v2.6，协作闭环）
  ├─ 参考 MultiCa 的 Skill 注入路径映射 → Crewden MCP Bridge 实现
  └─ Thread Intelligence / Context Package / Plan / Approval → 自主设计

Phase 3（v2.7，Autopilot — 最大收益点）
  ├─ 参考 MultiCa 的 autopilot 三表数据模型语义，在 SQLite/Cloudflare 约束下重新设计 schema
  ├─ 参考 DispatchAutopilot() 的算法语义，用 TypeScript 重新实现并发策略 + 模式路由
  ├─ 参考 computeNextRun() 的 cron 解析逻辑，在 TypeScript（cron-parser）+ Cloudflare Durable Object Alarm 约束下重新实现
  └─ 参考 SyncRunFromIssue/SyncRunFromTask 的生命周期联动模式，用 Crewden 事件总线重新实现

Phase 4（v2.8-v2.10，知识沉淀）
  ├─ 参考 MultiCa 的 Skill 文件结构与挂载模式
  └─ 扩展为 Crewden 的知识分层检索 + 自进化
```

---

## 七、具体可行性评估

### 7.1 v2.0 — Polymorphic Actor + Task 状态机

#### 可从 MultiCa 提取的设计资产

| 资产 | 来源文件 | 提取内容 | 价值评估 |
|---|---|---|---|
| **Polymorphic Actor 字段设计** | `001_init.up.sql` (issue, comment, inbox_item, activity_log) | `actor_type` + `actor_id` 的统一字段命名、CHECK 约束、索引策略 | ⭐⭐⭐⭐⭐ |
| **7→10 态状态机扩展参考** | `001_init.up.sql` issue.status CHECK | MultiCa 已有 `backlog/todo/in_progress/in_review/done/blocked/cancelled` 7态，Crewden 需扩展到 `spec_needed/changes_requested/qa` 等 10态 | ⭐⭐⭐⭐ |
| **依赖关系建模** | `001_init.up.sql` issue_dependency 表 | `blocks/blocked_by/related` 类型设计 + 独立表 vs JSON array 的取舍 | ⭐⭐⭐ |
| **位置排序** | `001_init.up.sql` issue.position FLOAT | 支持拖拽排序的 position 字段设计 | ⭐⭐⭐ |
| **乐观锁策略** | Crewden 独创 | MultiCa 无此设计，Crewden 需自行实现 version 字段 CAS | — |
| **看板列映射策略** | Crewden 独创 | 10态→5列的收敛映射是 Crewden 特有需求 | — |

#### 具体可参考的实现逻辑

**Task 状态变更校验模式**（参考 MultiCa `activity_log` 写入时机）：

```
MultiCa 的模式：
  状态变更 → 写入 activity_log（action + actor + details JSONB）
  所有 handler 内统一调用 createActivityLog()

Crewden 可复用：
  同样的"状态变更 → audit_log"模式
  参数结构：{ actorType, actorId, action, entityType, entityId, detail }
```

#### 不被提取的部分

- MultiCa 的 Go handler 代码（约 60+ .go 文件）无法直接转 TS
- Crewden 的 10 态状态机比 MultiCa 多 3 态，需重写 `VALID_TRANSITIONS`
- MultiCa 无乐观锁，Crewden 需自行实现 version CAS
- Board UI 完全不同（MultiCa 是 React 组件，Crewden 是独立 UI 框架）

**v2.0 综合评估：可提取约 40% 的设计参考，节省约 25% 设计时间。**

---

### 7.2 v2.1 — Agent Identity v2

| 资产 | 来源 | 提取内容 | 价值 |
|---|---|---|---|
| **agent 表字段设计** | `001_init.up.sql` + 后续 migration | `runtime_mode`, `runtime_config`, `visibility`, `status`, `max_concurrent_tasks`, `instructions` (在后续 migration) | ⭐⭐⭐⭐ |
| **Agent 状态模型** | `RefreshAgentStatusFromTasks` SQL 函数 | idle/working/blocked/error/offline 5 态 + 基于 task 自动推导 | ⭐⭐⭐ |
| **Agent-Skill 挂载** | `agent_skill` 关联表 | n-n 多对多挂载模式 | ⭐⭐⭐ |

**v2.1 综合评估：可提取约 35% 的设计参考，节省约 20% 设计时间。**

---

### 7.3 v2.7 — Autopilot（最大收益点）

#### 可从 MultiCa 提取的设计资产

| 资产 | 来源文件 | 提取内容 | 价值 |
|---|---|---|---|
| **完整数据模型** | `autopilot` / `autopilot_trigger` / `autopilot_run` 表 | 三表结构、字段命名、CHECK 约束、状态机 | ⭐⭐⭐⭐⭐ |
| **Schedule 调度器算法** | `cron.go` | `robfig/cron` 5-field parser + `ComputeNextRun()` + timezone 加载逻辑 | ⭐⭐⭐⭐⭐ |
| **Dispatch 核心流程** | `autopilot.go` → `DispatchAutopilot()` | 并发策略检查 → 创建 Run → switch 模式 → 发布事件 的完整流程 | ⭐⭐⭐⭐⭐ |
| **两种执行模式** | `dispatchCreateIssue()` / `dispatchRunOnly()` | create_issue：创建 issue + enqueue task；run_only：直接创建 task | ⭐⭐⭐⭐⭐ |
| **并发策略实现** | `DispatchAutopilot()` 内的 skip/queue/replace 逻辑 | skip：检查 active run → 跳过；queue：正常创建 run 排队；replace：取消上一个 run | ⭐⭐⭐⭐ |
| **Run 生命周期** | `SyncRunFromIssue()` / `SyncRunFromTask()` | issue 完成/取消 → run 联动；task 完成/失败 → run 联动 | ⭐⭐⭐⭐⭐ |
| **内置模板定义** | `handler/autopilot.go` → 模板 CRUD | 6 个模板的 cron 表达式、执行模式、assignee 逻辑 | ⭐⭐⭐⭐ |
| **模板插值** | `interpolateTemplate()` | `{{date}}` 替换逻辑 | ⭐⭐⭐ |
| **事件广播** | `EventAutopilotRunStart` / `EventAutopilotRunDone` | WebSocket 事件类型和 payload 结构 | ⭐⭐⭐⭐ |

#### 可参考的实现语义

**Cron 调度器**（语义等价，TypeScript 重新实现）：

```
Go 参考实现（cron.go）:
  robfig/cron/v3 5-field parser
  ComputeNextRun(cronExpr, timezone) → time.Time

TypeScript 实现（不复制代码，仅参考语义）:
  cron-parser (npm)  ← 不同库，相同 cron 标准语义
  calculateNextRun(cronExpr, timezone) → Date
  + Cloudflare Durable Object Alarm 替代常驻 setInterval
```

**Dispatch 流程**（算法语义可直接参考，在 TypeScript 约束下重新实现）：

```
1. 并发策略检查 → hasActiveRun(autopilotId)
   - skip: return
   - replace: cancelActiveRun(autopilotId)
   - queue: continue
2. 解析 assignee
3. 创建 autopilot_run（status=running/task_created）
4. switch executionMode:
   - create_issue: 创建 Task → enqueue
   - send_message: 发送消息到 Channel
5. 广播事件
6. 链接 issue/task 到 run
```

**Run 结束联动**（事件驱动模式）：

```
issue.status → done/cancelled → SyncRunFromIssue()
task.status  → completed/failed/cancelled → SyncRunFromTask()
```

#### 不被提取的部分

- Go 的 goroutine 定时扫描 → Crewden 按运行环境重新实现（Node 用 `setInterval`，Cloudflare 用 Durable Object Alarm）
- Go 的 pgx 事务处理 → TypeScript 用 better-sqlite3 事务

**v2.7 综合评估：可提取约 80% 的设计参考，节省约 55% 开发时间。**

这是所有版本中收益最大的——Autopilot 的业务语义与语言无关，Go 实现只作为理解状态流和边界条件的参考蓝图，不复制代码。

---

### 7.4 v2.6 — Code Execution & Review

| 资产 | 来源 | 提取内容 | 价值 |
|---|---|---|---|
| **Git 集成策略** | `daemon/execenv/git.go` | clone/checkout 白名单仓库的逻辑 | ⭐⭐⭐ |
| **Review 反馈机制** | `comment` + `activity_log` 表 | 评论 + 状态变更的记录模式 | ⭐⭐ |

**v2.6 综合评估：可提取约 25% 的设计参考。** 因为 MultiCa 的 git 操作在 daemon 层（Go 进程），Crewden 需要在 MCP Bridge 层实现。

---

### 7.5 v2.8 / v2.10 — Knowledge & Self-Evolution

| 资产 | 来源 | 提取内容 | 价值 |
|---|---|---|---|
| **Skill 注入机制** | `daemon/execenv/` 下各 provider 目录 | 将 Markdown 文件写入 agent CLI 工作目录的 provider 原生位置 | ⭐⭐⭐⭐ |
| **Skill 文件结构** | `skill` + `skill_file` 表 | 主文档 + 附属文件树的数据模型 | ⭐⭐⭐ |
| **Skill 挂载模式** | `agent_skill` n-n 关联 | agent ↔ skill 多对多的管理方式 | ⭐⭐⭐ |

#### 可直接复用的 Skill 注入路径映射

```
Claude Code → .claude/skills/{name}/SKILL.md
Codex      → CODEX_HOME/skills/{name}/
OpenCode   → .config/opencode/skills/{name}/SKILL.md
Pi         → .pi/skills/{name}/SKILL.md
```

Crewden 的 Paseo Runtime 可以通过 MCP Bridge 实现同样逻辑。

**v2.8 / v2.10 综合评估：可提取约 35% 的设计参考，节省约 20% 设计时间。**

---

### 7.6 不可提取的总览

| Crewden v2.x 版本 | 不可提取原因 |
|---|---|
| v2.2 Decision & Document | MultiCa 无此概念 |
| v2.3 Thread Intelligence | MultiCa 无 Thread 模型 |
| v2.4 Context Package | MultiCa 无此概念 |
| v2.5 Plan & Approval | MultiCa 无审批流 |
| v2.9 Full Trace | MultiCa 只有 activity_log，无 span-based trace |

---

### 7.7 总体节省估算

| 版本 | 设计参考价值 | 预计节省开发时间 | 主要得益于 |
|---|---|---|---|
| **v2.0** | ★★★★☆ | ~25% | Polymorphic Actor schema、activity_log 模式 |
| **v2.1** | ★★★☆☆ | ~20% | agent 表设计、状态自动推导 |
| **v2.2** | ★☆☆☆☆ | ~5% | 仅 Document 对象的状态机有点参考 |
| **v2.3** | ★★☆☆☆ | ~10% | Inbox 的多态 recipient 设计 |
| **v2.4** | ★☆☆☆☆ | ~5% | 几乎无参考 |
| **v2.5** | ★☆☆☆☆ | ~5% | 几乎无参考 |
| **v2.6** | ★★★☆☆ | ~15% | Skill 注入路径、git 白名单策略 |
| **v2.7** | ★★★★★ | **~55%** | 完整 Autopilot 数据模型 + 调度算法 + 生命周期 |
| **v2.8** | ★★★☆☆ | ~20% | Skill 文件结构 + 注入机制 |
| **v2.9** | ★★☆☆☆ | ~10% | activity_log + task_message 记录模式 |
| **v2.10** | ★★☆☆☆ | ~15% | Skill 沉淀的触发时机参考 |
| **总体** | | **~20%** | v2.7 是主力贡献 |

---

### 7.8 关键设计资产列表（可直接作为实现蓝图）

| # | 资产 | 来源文件 | 用于 Crewden 版本 |
|---|---|---|---|
| 1 | Autopilot 三表 DDL | migration 文件 | v2.7 |
| 2 | DispatchAutopilot 完整流程 | `autopilot.go:44-95` | v2.7 |
| 3 | Cron 解析 + 时区处理 | `cron.go` | v2.7 |
| 4 | Run 生命周期联动 | `SyncRunFromIssue/SyncRunFromTask` | v2.7 |
| 5 | Polymorphic Actor 字段规范 | `001_init.up.sql` | v2.0 |
| 6 | Skill 注入路径映射表 | `execenv/` 各 provider | v2.8 |
| 7 | Agent 状态自动推导逻辑 | `RefreshAgentStatusFromTasks` | v2.1 |
| 8 | 并发策略实现模式 | `DispatchAutopilot:44-60` | v2.7 |

---

## 八、风险与缓解

| 风险 | 概率 | 影响 | 具体缓解措施 |
|---|---|---|---|
| **设计参考过度依赖 MultiCa 模式** | 中 | 中 | 以 Crewden 的 10 态状态机和 Paseo Runtime 为锚点；MultiCa 仅作"另一个成熟实现的参考"，不盲从 |
| **MultiCa 的 Go 并发模型无法直译** | 高 | 中 | goroutine → Node `setInterval` / Cloudflare Durable Object Alarm；pgx 事务 → better-sqlite3 事务。语义等价但实现不同，需额外测试 |
| **Cron 库差异导致行为不一致** | 中 | 中 | MultiCa 用 `robfig/cron`（Go），Crewden 用 `cron-parser`（npm）。编写交叉测试验证相同 cron 表达式产生相同 next_run_at |
| **Autopilot 的复杂度过早引入** | 中 | 中 | v2.7 在 v2.0-2.5 之后才实现，届时基础设施（Task 状态机、Agent Identity、Plan/Approval）已成熟，不会出现"Autopilot 过于超前"的问题 |
| **Skill 注入与 Paseo 的 MCP 机制冲突** | 低 | 高 | Skill 文件写入 agent workspace → 通过 MCP Bridge 的 `crewden skill inject` 工具实现；不走 daemon 层 |
| **设计学习成本** | 低 | 低 | MultiCa 的 Go 代码结构清晰，handler/service 分层明确，阅读成本可控 |

---

## 九、结论

### 9.1 最终判断

**方案 B 可行且务实。** 最大收益集中在 v2.7（Autopilot），其约 80% 的设计语义可参考并在 TypeScript/SQLite/Cloudflare 约束下重新实现，节省约 55% 的开发时间。v2.0 的 Polymorphic Actor 设计也能从 MultiCa 的成熟实践中获得约 25% 的效率提升。其他版本受益有限，但不影响整体可行性。

### 9.2 核心原则

- **不从 MultiCa 移植代码**——Go 与 TypeScript 技术栈不可调和
- **不从 MultiCa 引入运行时依赖**——不部署 MultiCa Server，不启用 MultiCa Daemon
- **Paseo 保持唯一 Agent Runtime**——Crewden 已完成 Paseo 单栈收敛，不回头
- **参考设计，自主实现**——MultiCa 是设计蓝图，Crewden 是自己的工程

### 9.3 关键红线

| 红线 | 说明 |
|---|---|
| ❌ 不在 Crewden 中引入 Go 运行时 | 保持 Node.js 单栈 |
| ❌ 不启用 MultiCa Daemon | 与 Paseo 产生根本性冲突 |
| ❌ 不部署 MultiCa Server | 纯设计参考，零运维耦合 |
| ✅ 参考 MultiCa DDL 设计 Crewden schema | 提取字段命名、约束、索引策略 |
| ✅ 翻译 MultiCa 核心算法为 TypeScript | DispatchAutopilot、cron 调度、生命周期联动 |
| ✅ Crewden 保持 Paseo 作为唯一 Agent Runtime | 集成架构不变 |

### 9.4 下一步

1. **立即可用**：在实现 v2.0 时，打开 MultiCa 的 `001_init.up.sql` 作为 Polymorphic Actor 字段设计的参考
2. **v2.7 前**：详细阅读 `autopilot.go` 和 `cron.go`，编写 TypeScript 版本的技术设计文档
3. **持续同步**：关注 MultiCa 的 GitHub releases，跟踪 Autopilot 和 Skill 系统的新特性
