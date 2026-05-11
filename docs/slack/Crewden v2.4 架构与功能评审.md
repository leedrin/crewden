

日期：2026-05-07

评审视角：Agentic Harness Patterns × v2.x 设计意图 × 当前实现状态（v2.4 完成点）

代码基线：feat/slack-like-ai-agent

一、项目当前状态总览

Crewden 已完成 v1.5.1 的 Paseo Server 合并，进入 v2.0 阶段开发，当前完成到 v2.4。

完成路线：v2.0 → v2.1 → v2.2 → v2.2.1 → v2.3 → v2.4 ↓ ↓ ↓ ↓ ↓ ↓ Polymorphic Agent Decision Project Thread Context Actor + Identity & Document Isolation Intell. Package Task Contract v2

当前代码规模：

包

核心文件

行数

shared

protocol.ts + validation.ts

~600

hub-core

8 模块

~800

paseo-client

MCP bridge + WS client

~1500

server

db.ts (2204) + 15 routes + 7 runtime modules

~3000+

cloudflare

src/index.ts (4470)

4470

web

React SPA + components

~5000+

验证状态： pnpm verify 全部通过（166 tests），Cloudflare dry-run 通过，Web build 通过。

二、与 Agentic Harness 六层模型的对照评审

2.1 记忆系统 ⭐⭐⭐

Harness 原则

Crewden 现状

差距

指令记忆（分层人工配置）

AGENTS.md + docs/for_coding_agent/ 有手写规则，但无分层注入机制

缺少组织/项目/用户层自动合并

自动记忆（Agent 自主写入）

Knowledge Layer（v1.5）支持 6 种 knowledge kind + search/read/write API

✅ 基本到位

两步保存不变式（先主题文件，再索引）

Knowledge 走 DB 表写入，以 API 事务保证原子性

语义等价，架构不同

会话提取（后台 Agent）

无——会话结束时无自动知识提取

crewden 非对话型 Agent，可能不适用

审查与晋升

无——/remember 类机制缺失

v2.8 规划中

小结： knowledge_entries 表 + CRUD API 提供了扎实基础。但知识治理（stale/conflict 检测 → 晋升提案）在 v2.8 才规划，目前缺少自动维护。Knowledge entries 无上限控制，长期运行可能无限增长。

2.2 技能系统 ⭐⭐

Harness 原则

Crewden 现状

差距

懒加载元数据+按需激活

无技能模型——用 MCP tools 替代

轻量但有效

字符上限+截断

MCP tool descriptions 有描述但无截断控制

20+ tools 的描述可能撑大 prompt

Fork/隔离执行

Paseo daemon turn-based 会话天然隔离

✅

来源去重

无技能来源机制

v2.10 规划 skill capture

小结： crewden 选择了 MCP tools 路线而非 Skills 路线——合理。MCP tools 提供工具调用发现，Harness 的 Skills 更偏向"领域专家 prompt 注入"。MCP tool 描述预算需要关注。

2.3 工具与安全 ⭐⭐⭐

Harness 原则

Crewden 现状

差距

fail-closed 默认

Agent permissions 模型（v2.1）做 API 级门控

粗粒度，不是工具级

按调用分类并发

Paseo daemon 控制会话级串行

✅

多来源权限管道

agent_permissions 表 + requestAgentAuth.ts 中间件

单层，无配置文件→CLI→规则的分层

交互型/自动化/异步分发

Paseo daemon permission request → Web UI 审批流

✅

小结： 安全模型是两层：Agent 权限（粗粒度 API 门控）+ 运行时权限（Paseo daemon 的 per-turn 权限请求）。MCP tools 没有 per-tool 权限门控——这是未来的风险点。

2.4 上下文工程 ⭐⭐⭐⭐

Harness 原则

Crewden 现状

差距

选择（三级渐进披露）

ContextPackage (v2.4) 按优先级 5 级裁剪

✅ 设计文档 §6 与 Harness 完全对齐

写回

Knowledge API + Task 状态更新

✅

压缩

Thread summaries (v2.3) 自动生成

✅ 但轮次级对话压缩还没有

隔离

Paseo daemon turn-based 会话 + Fork 单层限制

✅

小结： 这是 crewden 最强的部分。ContextPackage Engine + Thread Intelligence 完全对应 Harness 的"选择+压缩"原则。但 ContextPackage 生成后是静态快照，无自动失效机制——如果关联的 document 更新了，agent 仍用旧 context（见陷阱部分）。

2.5 多 Agent 协调 ⭐⭐⭐

Harness 原则

Crewden 现状

差距

Coordinator 模式

v1.4 delegation + v2.0 task claim/assign

✅

Fork 模式

Paseo daemon 支持 sub-agent fork（单层限制）

✅

Swarm 模式

无

v2.7 Autopilot 最近接

Research→Synthesize→Implement→Verify

Task as Execution Contract + Review flow

流程存在但需人工推动

Worker prompt 自包含

ContextPackage (v2.4) 为每个 task 自动生成

✅

小结： crewden 的协调模型是 Task-based 而非 Agent-driven——任务先存在，Agent 再 claim。Harness 描述的"协调者消化 worker 结果成精确规格，再派发实现"还没有全自动闭环。综合步骤目前靠人。

2.6 生命周期与可扩展性 ⭐⭐

Harness 原则

Crewden 现状

差距

Hook 系统

无

没有 before/after tool execution 等注入点

长期运行工作追踪

Task 状态机 (v2.0) + audit_log

✅

Bootstrap 阶段化初始化

Server 启动有基本初始化，无记忆化阶段

简单

信任边界门控

browserAuth.ts 有登录态

Hook 信任门控不适用

小结： crewden 的扩展通过 MCP tools + Paseo provider 机制，当前规模不需要 Hook 系统。

三、v2.x 七层架构实现现状

v2.x 路线图（10 个版本）→ 当前 v2.4 完成 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ L1 协作层 ████████░░ 80% ✅ Channel, Thread, DM, Agent Profile 已到位 ✅ Agent Identity v2 (role/capabilities/permissions) ✅ Project 多项目隔离 ⬜ Canvas, 多 workspace（规划外） L2 对话引擎 ██████░░░░ 60% ✅ 消息意图分类 (chat/task/goal) ✅ Thread 摘要自动生成 ✅ Decision & Document 对象落地 ⬜ RAG 检索、全文搜索 (v2.8) L3 编排器 ████░░░░░░ 40% ✅ Context Package 自动生成 ✅ Task 状态机 (10 态) ⬜ Plan 对象 + 审批流 (v2.5) ⬜ Agent 发现/路由/委派引擎 (v2.5) L4 Runtime ████████░░ 80% ✅ Paseo daemon turn-based 执行 ✅ Context Package 注入到 task context ✅ MCP bridge tools (20+) ⬜ Role-based 上下文限制（部分） L5 工具层 ████░░░░░░ 40% ✅ crewden_* MCP tools ⬜ Git 操作 (branch/create PR/merge) — v2.6 ⬜ CI 触发 — v2.6 L6 审计层 ████░░░░░░ 40% ✅ 基础 audit_log + task 关键动作可审计 ⬜ 全链路 Trace (span-based) — v2.9 ⬜ 统一 Activity Feed — v2.9 L7 审批层 ██░░░░░░░░ 20% ✅ Paseo permission request 审批流打通 ⬜ Approval 对象 + 完整状态机 — v2.5 ⬜ Human-in-the-loop 机制 — v2.5

关键观察： v2.0-v2.4 完成了地基 + 对话引擎 + 上下文工程。接下来三个版本 (v2.5 Plan&Approval, v2.6 Code Execution, v2.7 Autopilot) 是"从文档系统到执行系统"的关键跃迁，也是最难的部分。

四、代码结构核心问题

问题 1：db.ts (2204 行) 是 God File

packages/server/src/db.ts 职责拆解估算：

数据访问 (SQL): ~40% 890 行 业务规则 (状态校验): ~25% 550 行 Agent 生命周期: ~15% 330 行 消息处理 (意图分类调用): ~10% 220 行 事务管理: ~5% 110 行 其他: ~5% 110 行

architecture-analysis.md 已指出此问题，但 v2.0-v2.4 四个版本过后仍未拆分。每次加功能都在末尾追加。

严重程度：🔴 高 — 拖慢开发速度和正确性保证。

问题 2：hub-core 被架空

hub-core 当前只有 8 个模块（agent、agentResolve、agentResolver、contextPackageBuilder、goalAlignment、intentClassifier、machine、message）。大量核心逻辑仍在 server/db.ts 和 cloudflare/src/index.ts (4470 行) 中重复实现：

•

任务状态机校验

•

Agent 委派逻辑

•

消息路由

•

Delivery 策略

后果：

•

server 和 cloudflare 在重复实现业务规则

•

测试只能在集成层做，无法单测业务逻辑

•

cloudflare 的 parity 靠手工对齐，不是共享代码保证

v2.2.1 handoff 标注了 “Cloudflare worker parity for project_id data model is not yet fully mirrored”——双端 parity 已出现裂缝。

严重程度：🔴 高

问题 3：cloudflare/src/index.ts 4470 行的单体 Worker

HTTP 路由、DO 状态管理、SQL 查询、业务校验、agent 生命周期全部塞进一个文件。Paseo client 连接管理在 server 端，cloudflare 不直连 Paseo——这是正确的设计决策，但 Worker 自身代码需要同样的拆分。

严重程度：🔴 高 — 与问题 1 同源但更严重（无任何模块化）。

问题 4：Web 类型孤立

web 不依赖 @crewden/shared。API 返回类型的 TypeScript 定义在 packages/web/src/api.ts 中手工维护。v2.0-v2.4 每个版本都增加了新的 protocol 类型（ContextPackage、Decision、Document、ThreadSummary 等），Web 端都需要手动同步。

严重程度：🟡 中 — 目前手动维护尚能工作，但随着类型增长会变成 bug 来源。

问题 5：无 Repository 抽象

server/routes/*.ts 直接 import db.ts 调用 getOrCreateDb().createMessage(...)。如果要替换存储后端，需要修改所有 15 个 route 文件。

严重程度：🟡 中 — 当前只有 SQLite 一种存储，但架构缺乏防御性。

五、Agentic Harness 踩坑指南对照

#

陷阱

Crewden 暴露

风险

1

并发分类按调用不是按类型

✅ 已有——Paseo per-turn 串行

低

2

权限评估有副作用

⚠️ agent_permissions 是纯查询，但 Paseo permission request 审批流引入了副作用

中

3

异步工作跳过 pending

N/A——Task 状态机有 spec_needed 等中间态

低

4

Fork 子级不能 fork

Paseo daemon 管控

低

5

上下文构建器记忆化但手动失效

ContextPackage 生成后存储在 task.context 中，无失效机制

🔴 高

6

记忆索引有硬上限

Knowledge entries 无上限控制

🟡 中

7

技能列表预算紧

用 MCP tools 替代，20+ tools 的 description 可能撑大 prompt

🟡 中

8

Hook 信任全有或全无

N/A——无 Hook 系统

低

9

工具默认权限是 allow

MCP tools 没有 per-tool 权限门控

🟡 中

陷阱 5 详解：ContextPackage 静态快照问题

ContextPackage 生成后就成了静态快照。当以下情况发生时，ContextPackage 不会自动失效：

1.

关联的 documents/decisions 被更新

2.

Parent task 完成并产生新的交付物

3.

Thread 中产生新的关键决策

虽然有 POST /api/tasks/:id/context-package 手动 regenerate 端点，但：

•

默认不失效意味着 agent 可能用过期上下文执行

•

用户/AI 需要手动意识到需要 regenerate

•

没有任何 staleness 标记或自动检测

建议修复：

•

在 document/decision 更新时，标记关联 task 的 contextPackage 为 stale

•

在 agent 拉取 task 时检查 staleness 并触发重新生成

•

在 ContextPackage 中添加 generatedAt 和 dataSourcesUpdatedAt 时间戳

六、架构评分

维度

评分

变化

说明

分层清晰度

⭐⭐⭐⭐

持平

6 包职责分明，依赖方向正确

单向依赖

⭐⭐⭐⭐⭐

持平

零反向依赖

关注点分离

⭐⭐⭐

下降

db.ts 从 2200→2204 行，cloudflare 4470 行

可测试性

⭐⭐⭐

持平

仍无 Repository 接口，难以 mock 数据层

功能完整性

⭐⭐⭐⭐

大幅上升

v2.0-v2.4 四个版本密集交付

云/本地 parity

⭐⭐⭐

下降

project_id 已有 parity 裂缝

七、改进建议（按优先级）

P0 — 立即执行

1. 拆分 db.ts 和 cloudflare/src/index.ts

不是一次性大重构，而是每新增一个模块就提取一个 repository + service：

v2.5 Approval 不要加到 db.ts 末尾，而是新建： packages/server/src/repository/approval.repository.ts packages/server/src/service/approval.service.ts

同样的提取方式应用到 cloudflare Worker。逐步将现有逻辑迁出，而非一次重写。

2. ContextPackage 失效机制

•

在 document/decision 更新时，标记关联 task 的 contextPackage 为 stale

•

在 agent 拉取 task 时检查 staleness 并触发重新生成

•

在 ContextPackage 类型中添加 generatedAt 字段

P1 — 下个版本（v2.5）同步实施

3. 充实 hub-core 作为真正的业务逻辑层

以下逻辑目前在 server 和 cloudflare 重复实现，应提取到 hub-core：

模块

目标文件

当前所在

Task 状态转换校验

hub-core/src/taskStateMachine.ts

db.ts + cloudflare/index.ts

Agent 委派/匹配逻辑

hub-core/src/agentDelegation.ts

delegation.ts + db.ts

Delivery 策略

hub-core/src/deliveryPolicy.ts

taskDelivery.ts

消息路由/意图分类调用

hub-core/src/messageRouter.ts

db.ts 中 classifyMessageIntent 调用点

4. Web 类型引入 shared

# web 添加 devDependency pnpm --filter @crewden/web add -D @crewden/shared

将 packages/web/src/api.ts 中的手工类型替换为 import type 从 shared。

P2 — 后续版本规划

5. MCP tool 描述预算控制

•

按 ContextPackage 的 callable tools 做过滤，只暴露当前 task 相关的 tools

•

对 tool description 添加字符上限

6. Knowledge entry 上限

•

添加最大条目数限制

•

达到阈值时触发"审查与晋升"流程

•

标记 stale 条目以支持清理

八、后续版本风险预警

版本

主题

核心风险

缓解措施

v2.5

Plan & Approval

在 4470 行 cloudflare 文件上叠加审批状态机

先做 P0-1 拆分

v2.6

Code Execution

Agent 首次获得写文件/创分支能力

强化 per-tool 权限门控

v2.7

Autopilot

定时任务自动触发 Agent 执行

严格限制 Autopilot 可触发的 task 类型

v2.8

Knowledge Layer

知识爆炸 + 过期

提前设计 staleness 和上限

v2.9

Full Trace

Trace 数据量 = 2-10倍 audit_log

设计存储策略和保留策略

v2.10

Self-Evolution

Agent 改写自己的配置

所有自修改操作必须走 Approval Gate

九、总结

crewden 在 v2.0-v2.4 的密集开发中功能大幅增长。ContextPackage + Thread Intelligence + Polymorphic Actor 三个核心设计精准对齐了 Agentic Harness 的上下文工程和多 Agent 协调模式，设计文档质量高、路线清晰。

但代码结构债务在同步累积：

•

db.ts (2204 行) 和 cloudflare/src/index.ts (4470 行) 两个 God File 的持续膨胀是当前最大风险

•

hub-core 被架空导致 server/cloudflare 两端重复实现业务逻辑

•

ContextPackage 无自动失效机制，agent 可能用过期上下文执行

•

Web 端类型孤立，手工维护成本随类型增长

核心建议：在 v2.5 实施前做一次轻量拆分（边走边拆），避免在 4470 行文件上继续叠加新功能。每新增一个模块就提取一对 repository + service，逐步将业务逻辑收敛到 hub-core。