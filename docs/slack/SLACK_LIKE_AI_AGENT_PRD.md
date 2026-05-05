# 面向 AI Agent 的协作式研发操作系统 —— 功能需求 PRD

> 基于「Slack-like 面向 AI Agent 的协作式研发操作系统方案」终极规划，
> 详细阐述 8 条设计路线、12 个核心系统对象的设计意图、功能目的、方法手段和验收标准。
>
> 日期：2026-05-04
> 状态：下阶段开发整体规划

---

## 目录

- [一、产品概述](#一产品概述)
- [二、12 个核心系统对象 PRD](#二12-个核心系统对象-prd)
  - [2.1 Channel](#21-channel)
  - [2.2 Thread](#22-thread)
  - [2.3 Agent](#23-agent)
  - [2.4 Decision](#24-decision)
  - [2.5 Document](#25-document)
  - [2.6 Task](#26-task)
  - [2.7 Plan](#27-plan)
  - [2.8 PR / Code Change](#28-pr--code-change)
  - [2.9 Review](#29-review)
  - [2.10 Approval](#210-approval)
  - [2.11 Tool Call](#211-tool-call)
  - [2.12 Trace](#212-trace)
- [三、8 条设计路线 PRD](#三8-条设计路线-prd)
  - [3.1 路线一：Agent 身份与权限体系](#31-路线一agent-身份与权限体系)
  - [3.2 路线二：Task 执行契约引擎](#32-路线二task-执行契约引擎)
  - [3.3 路线三：沟通与知识库体系](#33-路线三沟通与知识库体系)
  - [3.4 路线四：Agent Orchestrator 编排器](#34-路线四agent-orchestrator-编排器)
  - [3.5 路线五：Meta-Agent 知识与自进化](#35-路线五meta-agent-知识与自进化)
  - [3.6 路线六：Polymorphic Actor 多态协作](#36-路线六polymorphic-actor-多态协作)
  - [3.7 路线七：Autopilot 自主工作引擎](#37-路线七autopilot-自主工作引擎)
  - [3.8 路线八：Skill 与上下文注入](#38-路线八skill-与上下文注入)
- [四、MVP 功能范围定义](#四mvp-功能范围定义)
- [五、验收标准总览](#五验收标准总览)

---

## 一、产品概述

### 1.1 产品定位

```
Slack-like Agent Collaboration OS
  + Task Board Execution Engine
  + Code / Doc / Review Toolchain
```

**一句话**：面向 AI Agent 的协作式研发操作系统 —— 把 Agent 从"工具"升级为"有身份、有职责、可追溯、可审计的团队成员"。

### 1.2 要解决的核心问题

| 问题               | 现状                      | 目标                                   |
| ------------------ | ------------------------- | -------------------------------------- |
| Agent 没有身份边界 | Agent 只是一个命令行工具  | Agent 有角色、职责、权限、能力画像     |
| 上下文无限膨胀     | 每次把所有历史塞进 prompt | Context Package 精确裁剪               |
| 执行不可靠         | Agent 说"完成了"就完成    | 严格状态机 + PR + CI + Review 才 Done  |
| 决策无法追溯       | 讨论消失在聊天记录里      | Decision / ADR 显式记录                |
| 知识无法复用       | 每次从零开始              | 知识分层检索 + 从成功任务沉淀 Skill    |
| 高风险管理缺失     | 没有审批机制              | Human-in-the-loop + Approval Gate      |
| 多 Agent 协作混乱  | 各自为战                  | Orchestrator 路由 + Handoff 上下文传递 |

### 1.3 核心闭环

```text
讨论 → 文档 → 任务 → 执行 → Review → 合并 → 沉淀
```

### 1.4 7 条设计原则

1. **Agent 是有明确身份、职责、权限边界的团队成员**
2. **Chat 是协作入口，结构化对象是事实源**
3. **Agent 可以自由讨论，但执行必须结构化**
4. **高风险动作必须 Human-in-the-loop**
5. **Agent 不应拥有无限上下文 —— Context Budget 管理**
6. **Review-first —— 所有 Agent 产物默认进入 Review**
7. **Traceable Autonomy —— 每一次 Agent 行动可追溯**

---

## 二、12 个核心系统对象 PRD

### 2.1 Channel

#### 设计意图

Channel 是按领域划分的讨论空间，人和 Agent 在其中共同参与讨论。不是简单的聊天室，而是协作的容器——每个 Channel 有明确的主题域、参与 Agent 白名单和消息生命周期。

#### 功能目的

- 按领域隔离讨论上下文（architecture / frontend / qa / release）
- 控制 Agent 的可见范围（Agent 只能读被授权的 Channel）
- 作为 Thread 和 Decision 的容器

#### 方法手段

```typescript
interface Channel {
  id: string;
  name: string; // #architecture, #frontend
  description: string; // 频道用途说明
  participants: {
    // 参与成员（人 + Agent）
    actorType: "human" | "agent";
    actorId: string;
    role: string; // 在此频道中的角色：participant / observer / moderator
  }[];
  defaultAgents: string[]; // 默认参与此频道的 Agent
  messageRetentionDays?: number; // 消息保留天数
  settings: {
    autoSummarize: boolean; // 是否自动生成 Thread 摘要
    requireApprovalForNewAgent: boolean; // 新增 Agent 是否需要审批
  };
  createdAt: Date;
}
```

#### 验收标准

- [ ] 用户可以创建/删除 Channel
- [ ] Agent 可以被添加到 Channel 或从 Channel 移除
- [ ] Agent 只能读取和写入被授权 Channel 的消息
- [ ] Channel 消息按时间排序，支持分页加载
- [ ] 可以设置 Agent 在 Channel 中的参与角色（participant / observer）

---

### 2.2 Thread

#### 设计意图

Thread 是 Channel 内的聚焦讨论线程，将相关消息聚合在一起，避免污染主频道。每个 Thread 有独立的状态生命周期、参与者和可生成的决策。

#### 功能目的

- 聚焦特定话题的讨论（如一个需求、一个 Bug、一个架构决策）
- 保持主频道整洁，避免话题混乱
- 作为 Decision、Document、Task 的来源追溯
- 自动生成摘要，减少 Agent 需要阅读的上下文量

#### 方法手段

```typescript
interface Thread {
  id: string;
  channelId: string;
  rootMessageId: string; // 触发 thread 的原始消息
  title: string; // 自动或手动设置的标题
  status: "active" | "resolved" | "archived";
  participants: {
    actorType: "human" | "agent";
    actorId: string;
  }[];
  summary?: {
    content: string; // 自动生成的线程摘要
    generatedAt: Date;
    generatedBy: "system";
  };
  linkedObjects: {
    decisions: string[]; // 此线程产生的 Decision id 列表
    documents: string[]; // 此线程产生的 Document id 列表
    tasks: string[]; // 此线程产生的 Task id 列表
  };
  messageCount: number; // 消息数（触发摘要的阈值）
  createdAt: Date;
  resolvedAt?: Date;
}
```

#### 验收标准

- [ ] 用户可以从任意消息创建 Thread
- [ ] Thread 内消息按时间排序，支持嵌套回复
- [ ] Thread 消息数 > 10 时自动生成摘要
- [ ] Thread resolved 时生成最终摘要
- [ ] Thread 可以链接到 Decision / Document / Task
- [ ] Thread 摘要作为上下文注入到相关 Task 的 Context Package 中

---

### 2.3 Agent

#### 设计意图

Agent 不是"命令行工具"或"AI 模型"，而是**有明确身份、职责、能力画像和权限边界的团队成员**。Agent 在系统中与人地位对等——可以创建内容、参与讨论、被委派任务、有自己的 inbox。

#### 功能目的

- 定义 Agent 的角色和职责（Product / Architect / Developer / QA / Reviewer 等）
- 定义 Agent 的能力标签（机器匹配用）
- 定义 Agent 的权限边界（硬约束：能做什么、不能做什么）
- 定义 Agent 的上下文限制（最大 token 数）
- 作为任务分配和委派的依据
- 作为审批流中的请求者

#### 方法手段

```typescript
interface AgentProfile {
  // === 身份 ===
  id: string;
  name: string;
  displayName: string;
  avatar: string;

  // === 角色与职责 ===
  role: AgentRole; // Product | Architect | Developer | QA | Reviewer | Security | DevOps | Documentation | Coordinator
  responsibilities: string[];
  capabilities: string[]; // requirements, coding, review, testing, security...

  // === 权限边界（硬约束，系统强制执行）===
  permissions: {
    readChannels: string[];
    writeChannels: string[];
    createDocs: boolean;
    createTasks: boolean;
    claimTasks: boolean;
    createBranches: boolean;
    createPRs: boolean;
    mergeToMain: boolean; // 默认 false
    deployToStaging: boolean;
    deployToProd: boolean; // 默认 false
    accessSensitiveData: boolean;
    callExternalAPIs: string[];
  };

  // === 工作风格 ===
  workingStyle: "execution" | "planning" | "reviewing" | "researching";
  handoffPreference: string;

  // === 上下文限制 ===
  maxContextTokens: number; // 默认 100k
  requiresApprovalFor: string[]; // 哪些操作需要审批

  // === 运行时状态 ===
  status: "online" | "offline" | "working" | "idle" | "blocked";
  currentLoad: number;
  currentTaskId?: string;
  lastActiveAt: Date;

  // === 关联 ===
  provider: string; // Paseo provider
  runtimeId: string; // Paseo runtime instance id
}
```

#### 验收标准

- [ ] Agent Profile 包含上述所有字段
- [ ] 权限边界由系统强制执行（Agent 尝试越权操作返回 403）
- [ ] Agent 可被按 role/capability/workingStyle 检索和匹配
- [ ] Agent 在 inbox 中能看到分配给它的任务、@提及、review 请求
- [ ] Agent 状态变更实时推送到 Web UI
- [ ] Agent 的权限配置可由 human admin 修改
- [ ] Agent 不能修改自己的权限配置

---

### 2.4 Decision

#### 设计意图

频道中的讨论会产生许多结论，但如果没有显式记录，这些结论会消失在聊天记录中。Decision（ADR——Architecture Decision Record）是将讨论产生的实质性结论显式化的机制。每个 Decision 有完整的状态生命周期（proposed → accepted → deprecated → superseded）。

#### 功能目的

- 将频道讨论中的结论显式记录，避免"结论只在聊天里"
- 提供决策追溯：为什么做这个决定？有哪些替代方案？
- 支持决策的废弃和取代（deprecated / superseded）
- 作为 Agent 执行任务时的上下文输入

#### 方法手段

```typescript
interface Decision {
  id: string;
  channelId: string;
  sourceThreadId: string;
  title: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  context: {
    problem: string;
    alternatives: string[]; // 考虑的替代方案
    decision: string; // 最终决定
    rationale: string; // 决策理由
    consequences: string[];
  };
  participants: { actorType; actorId; role }[];
  relatedDecisions: string[]; // 关联的 Decision
  supersededBy?: string; // 被哪个新决定取代
  createdAt: Date;
  acceptedAt?: Date;
}
```

#### 验收标准

- [ ] 用户/Agent 可以在 Thread 中显式创建 Decision
- [ ] Decision 状态机完整（proposed → accepted → deprecated → superseded）
- [ ] Decision 自动关联到来源 Thread
- [ ] Decision 可以被搜索（按标题、内容、状态）
- [ ] Agent 执行相关 Task 时自动注入关联的 Decision 摘要

---

### 2.5 Document

#### 设计意图

工程文档（PRD、TDD、Test Plan、Runbook、Postmortem）是团队共识的载体。Document 对象提供统一的状态机和关联能力，确保文档不会变成"写了就过时"的僵尸。

#### 功能目的

- 统一管理各类工程文档（PRD / TDD / Test Plan / Runbook / Postmortem）
- 文档有独立状态机（draft → in_review → approved → deprecated → superseded）
- 文档可以关联到来源 Thread、关联 Decision、关联 Task
- Agent 可以在执行任务时检索相关文档摘要

#### 方法手段

```typescript
type DocumentKind = "prd" | "tdd" | "adr" | "rfc" | "test_plan" | "runbook" | "postmortem";

interface Document {
  id: string;
  kind: DocumentKind;
  title: string;
  status: "draft" | "in_review" | "approved" | "deprecated" | "superseded";
  content: string; // Markdown
  sourceThreadId?: string;
  sourceChannelId: string;
  author: { actorType; actorId; name };
  reviewers: { actorType; actorId }[];
  relatedDecisions: string[];
  relatedTasks: string[];
  supersededBy?: string;
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
}
```

#### 验收标准

- [ ] 支持 6 种文档类型（PRD / TDD / ADR / RFC / Test Plan / Runbook / Postmortem）
- [ ] 文档状态机完整（draft → in_review → approved → deprecated → superseded）
- [ ] 文档可以关联来源 Thread、关联 Decision、关联 Task
- [ ] Agent 可以从 Thread 讨论自动生成文档 Draft
- [ ] 文档 Draft 需要 Human Review 后才能进入 Approved
- [ ] Agent 执行 Task 时自动注入关联文档的摘要

---

### 2.6 Task

#### 设计意图

Task 不是简单的 Todo，而是 **Agent 的执行契约**。它定义了：谁执行、谁审查、谁审批、什么输入、什么约束、什么验收标准、什么工具可用、什么产出格式。v2.0 的 Task 状态机从 backlog 到 done/cancelled，发布态留给后续部署管道版本扩展。

#### 功能目的

- 作为 Agent 执行的唯一授权凭证
- 提供严格的 10 态状态机，防止非法状态转换
- 绑定 Context Package，控制 Agent 的上下文输入
- 绑定 Approval Gate，控制高风险操作的执行权限
- 提供依赖图，控制任务的执行顺序
- 记录执行历史（TaskRun），提供结构化交付物摘要

#### 方法手段

```typescript
type TaskStatus =
  | "backlog"
  | "spec_needed" // 需要补充规格，显示在 Backlog 列的 Needs Spec 细节态
  | "ready"
  | "assigned"
  | "in_progress"
  | "in_review"
  | "changes_requested"
  | "qa"
  | "done"
  | "cancelled";

interface Task {
  id: string;
  title: string;
  type: "feature" | "bug" | "chore" | "research" | "docs";

  // 来源追溯
  sourceChannelId: string;
  sourceThreadId?: string;
  sourceGoalId?: string;
  sourceDocumentId?: string;

  // 执行契约
  owner: { actorType; actorId };
  reviewer: { actorType; actorId };
  approver: { actorType: "human"; actorId };

  // 状态
  status: TaskStatus;
  priority: "P0" | "P1" | "P2" | "P3";

  // 依赖
  dependsOn: string[];
  blockedBy: { taskId?: string; reason?: string }[];

  // 约束
  acceptanceCriteria: string[];
  definitionOfDone: string[];
  constraints: string[];
  maxRuntimeMinutes?: number;

  // 上下文
  contextPackage?: ContextPackage;
  relevantDocs: string[];
  relevantDecisions: string[];

  // 执行记录
  implementationPlan?: Plan;
  runs: TaskRun[];
  branchName?: string;
  prUrl?: string;

  // 审批
  approvals: Approval[];

  // 时间线
  createdAt: Date;
  updatedAt: Date;
  assignedAt?: Date;
  completedAt?: Date;
}

// 合法的状态转换表
const VALID_TRANSITIONS = {
  backlog: ["spec_needed", "ready", "cancelled"],
  spec_needed: ["ready", "backlog"],
  ready: ["assigned", "backlog", "cancelled"],
  assigned: ["in_progress", "ready", "cancelled"],
  in_progress: ["in_review", "cancelled"],
  in_review: ["changes_requested", "qa", "done", "cancelled"],
  changes_requested: ["in_progress", "cancelled"],
  qa: ["done", "changes_requested", "cancelled"],
  done: [],
  cancelled: [],
};
```

#### 验收标准

- [ ] Task 包含上述所有字段
- [ ] 完整 10 态状态机，非法状态转换返回 422
- [ ] Task dependsOn 依赖图：支持 DAG 创建、循环检测、自动推进
- [ ] Task assigned 后自动生成 Context Package
- [ ] Task done 的唯一路径：PR merged + CI passed + Approval granted
- [ ] Task 执行过程全链路可审计（Trace）
- [ ] Task Board 按状态分列展示，支持拖拽变更状态
- [ ] Task 可以关联 Decision、Document、Thread

---

### 2.7 Plan

#### 设计意图

Agent 在执行编码任务前，必须先输出 Implementation Plan。Plan 是"我准备怎么做"的结构化表达——包含方案、步骤、风险、预计影响的文件。高风险 Plan 必须经过 Reviewer 预审和 Human 审批才能开始执行。

#### 功能目的

- 强制 Agent "先想再做"，减少盲目执行
- 高风险 Plan 进入 human-in-the-loop 审批
- Reviewer 可以预审 Plan，提前发现架构问题
- Plan 作为审计追踪的一部分（Agent 实际执行了什么 vs 计划了什么）

#### 方法手段

```typescript
interface Plan {
  id: string;
  taskId: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  content: {
    approach: string;
    steps: {
      description: string;
      verification: string; // 如何验证这一步完成
      estimatedTools: string[];
    }[];
    risks: { description: string; mitigation: string }[];
    filesToModify: string[];
    filesToCreate: string[];
    testsToAdd: string[];
  };
  author: { actorType: "agent"; actorId };
  reviewer?: { actorType; actorId; approved: boolean; comment?: string };
  createdAt: Date;
}
```

#### 验收标准

- [ ] Agent 执行编码任务（type = feature/bug/chore）前必须生成 Plan
- [ ] 文档类任务（type = docs/research）可跳过 Plan
- [ ] Plan 状态机：draft → submitted → approved → rejected
- [ ] P0/P1 任务的 Plan 需要 Reviewer 预审 + Human 审批
- [ ] P2/P3 任务的 Plan 可以 Reviewer-only 审批
- [ ] Plan 与最终 Task Run 的 diff 写入审计日志
- [ ] Plan rejected 时，Agent 必须重新生成

---

### 2.8 PR / Code Change

#### 设计意图

代码变更不直接在主干上发生，而是通过 Git branch + PR 的方式进行。PR 是"代码事实"的载体——PR diff 是 Agent 实际做了什么，Review 是对产出的评估，Merge 是完成信号。

#### 功能目的

- 隔离 Agent 的代码修改（不直接操作主干）
- PR diff 作为 Review 的对象
- PR status 作为 Task 状态推进的信号
- PR merge 作为高风险操作，需要 Approval

#### 方法手段

通过 MCP Tool Layer 集成 Git 操作：

```
Agent 可调用的 Git 工具：
  - git_create_branch(taskId, baseBranch)
  - git_commit(message, files)
  - git_create_pr(title, description, branch)
  - git_get_pr_status(prUrl)

Agent 不可调用的 Git 工具（需要 Human Approval）：
  - git_merge_to_main(prUrl)
```

#### 验收标准

- [ ] Agent 可以创建 branch（命名规范：task/{taskId}/{short-description}）
- [ ] Agent 可以 commit 和 push
- [ ] Agent 可以创建 PR
- [ ] Agent 不能直接 merge 到主干（需要 Human Approval）
- [ ] PR 创建后 Task 状态自动从 in_progress → in_review
- [ ] PR merged 后 Task 状态自动推进
- [ ] PR URL 记录在 Task 中

---

### 2.9 Review

#### 设计意图

分层审查机制——不是只有人类 Review，也不是只有 Agent 审查。而是 Agent Self Review → Specialized Review Agent → CI/Static Analysis → Human Review → QA 的多层防御。

#### 功能目的

- 确保代码质量：每层 Review 检查不同维度
- 防止 Agent 自说自话：不能 self-review 高风险任务
- 记录 Review 意见作为后续改进的输入

#### 方法手段

```
Review 分层：

L1: Agent Self Review
  → 提交 PR 前自检
  → 检查：acceptance criteria / tests / DoD

L2: Specialized Review Agent
  → 自动扫描 PR diff
  → 检查：架构边界 / 安全性 / 性能 / 代码规范

L3: CI / Static Analysis
  → lint / typecheck / unit test / security scan

L4: Human Review
  → Tech Lead 最终审查
  → 检查：需求符合度 / 交互合理性 / 技术债

L5: QA Verification
  → QA Agent 运行回归测试
```

#### 验收标准

- [ ] PR 创建后自动触发 L2 Review Agent 扫描
- [ ] L3 CI 结果自动关联到 PR
- [ ] L4 Human Review 可以 approve / request changes
- [ ] request changes 后 Task 状态回到 changes_requested
- [ ] P0/P1 任务默认不允许 self-review（executor ≠ reviewer）
- [ ] Review 意见记录在 Task 的 review history 中

---

### 2.10 Approval

#### 设计意图

高风险操作不能由 Agent 自主执行，必须经过人类审批。Approval 对象是"人类已确认可以执行"的凭证，有独立的状态机和过期机制。

#### 功能目的

- 对所有高风险操作提供 human-in-the-loop 闸门
- 审批有超时机制（避免无限等待）
- 审批记录可审计

#### 方法手段

```typescript
type ApprovalType =
  | "task_execution" // P0/P1 任务执行前
  | "architecture_decision" // 架构决策
  | "pr_merge" // 合并 PR 到主干
  | "deploy_staging"
  | "deploy_production"
  | "data_modification"
  | "schema_change"
  | "external_api_call"
  | "sensitive_data_access";

interface Approval {
  id: string;
  type: ApprovalType;
  targetId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedBy: { actorType: "agent"; actorId };
  approvedBy?: { actorType: "human"; actorId };
  reason: string;
  context: string; // 审批上下文
  requestedAt: Date;
  respondedAt?: Date;
  expiresAt?: Date; // 超时自动拒绝
}
```

#### 验收标准

- [ ] 所有 P0/P1 任务在进入 in_progress 前需要 Approval
- [ ] merge_to_main 操作需要 Approval
- [ ] deploy_to_prod 操作需要 Approval
- [ ] Approval 超时自动 rejected
- [ ] 审批记录写入 Audit Log
- [ ] Agent 不能自行审批自己的 Approval 请求
- [ ] Human approver 在 Web UI 中可以看到 pending approval 列表

---

### 2.11 Tool Call

#### 设计意图

Agent 在执行任务时需要调用各种工具（Git、CI、API 等）。每次工具调用都需要有权限检查、参数记录和结果审计。

#### 功能目的

- 记录 Agent 调用了什么工具、传了什么参数
- 权限检查：Agent 是否有权调用这个工具
- 作为 Trace 系统的一部分

#### 方法手段

通过 MCP Bridge 统一接入，每次调用记录：

```typescript
interface ToolCallRecord {
  id: string;
  traceId: string;
  taskId: string;
  agentId: string;
  toolName: string;
  params: Record<string, unknown>; // 参数（敏感字段 redacted）
  result: {
    success: boolean;
    summary: string;
    error?: string;
  };
  permissionCheck: {
    allowed: boolean;
    reason?: string;
  };
  timestamp: Date;
  durationMs: number;
}
```

#### 验收标准

- [ ] 每次 Agent 工具调用都有 ToolCallRecord
- [ ] 调用前进行权限检查（permissions.callExternalAPIs）
- [ ] 敏感参数（api_key, token, password）自动 redacted
- [ ] ToolCallRecord 可通过 Trace 系统查询

---

### 2.12 Trace

#### 设计意图

多 Agent 系统必须具备全链路可追溯能力。Trace 系统记录每一次任务的完整执行过程：谁触发、哪个 Agent 参与、读了什么上下文、调了什么工具、谁批准、改了哪些文件、最终结果是什么。

#### 功能目的

- 定位问题：Agent 做错了什么？哪一步出的问题？
- 审计合规：谁在什么时候做了什么
- 性能分析：哪一步耗时最长
- 复现：可以回放一次任务执行的完整过程

#### 方法手段

```typescript
interface TraceEvent {
  id: string;
  traceId: string; // 一次完整任务
  taskId: string;
  spanId: string; // 一个步骤
  parentSpanId?: string; // 父步骤
  eventType:
    | "task_created"
    | "task_assigned"
    | "context_package_generated"
    | "plan_generated"
    | "plan_approved"
    | "approval_granted"
    | "tool_call"
    | "tool_result"
    | "file_modified"
    | "file_created"
    | "test_run"
    | "test_result"
    | "pr_created"
    | "review_submitted"
    | "task_completed"
    | "error";
  actor: { actorType; actorId };
  detail: Record<string, unknown>;
  timestamp: Date;
}
```

#### 验收标准

- [ ] 每次 Task 从创建到完成有完整的 Trace 记录
- [ ] Trace 支持按 taskId / agentId / eventType 筛选
- [ ] Trace 记录自动关联到 Task 详情页展示
- [ ] 关键 eventType（plan_generated, approval_granted, pr_created, task_completed）必须覆盖
- [ ] Token / API key 等敏感字段在 Trace 中自动 redacted

---

## 三、8 条设计路线 PRD

### 3.1 路线一：Agent 身份与权限体系

#### 来源

融合 agencycli 的角色画像理念 + 终极规划的"Agent 是有明确身份/职责/权限边界的团队成员"原则。

#### 设计意图

让系统知道每个 Agent 是谁、擅长什么、能做什么、不能做什么。不是组织架构图，而是 Agent 的能力画像和权限边界。

#### 功能目的

- Agent 可被发现：其他 Agent 或人类可以根据 role/capability 找到合适的 Agent
- 权限硬约束：Agent 不能做超出权限的事
- 任务匹配：根据 Agent 能力自动推荐合适的任务执行者

#### 方法手段

参见 §2.3 Agent 对象设计。

**Agent 角色定义模板**：

```yaml
agent_id: developer-agent
role: Developer
capabilities: [coding, testing, debugging]
permissions:
  readChannels: [architecture, frontend, backend]
  writeChannels: [frontend, backend]
  createBranches: true
  createPRs: true
  mergeToMain: false # 硬约束
  deployToProd: false # 硬约束
requiresApprovalFor:
  - task_execution # P0/P1 任务执行前需审批
  - external_api_call
```

**Agent 匹配能力**：

```typescript
// 根据 role/capability 查找合适的 Agent
function resolveAgent(query: {
  role?: string;
  capabilities?: string[];
  excludeAgentId?: string; // RPD③1
}): AgentProfile[];
```

#### 验收标准

- [ ] Agent Profile 包含 role, responsibilities, capabilities, permissions, workingStyle
- [ ] permissions 由系统强制执行——越权操作返回 403
- [ ] resolveAgent 可按 role/capability 匹配
- [ ] MVP 阶段至少有 3 个 Agent（Coordinator, Product, Architect）
- [ ] Agent 状态实时推送到 Web UI

---

### 3.2 路线二：Task 执行契约引擎

#### 来源

融合 agencycli 的 Task 状态机、Hermes 的需求补规格经验和 Run 历史，以及终极规划的"Task as Execution Contract"。

#### 设计意图

Task 不是简单的 Todo，而是 Agent 的执行契约——定义了完整的状态生命周期、依赖、约束、验收标准和审批要求。Task Board 是执行状态的唯一事实源。

#### 功能目的

- 10 态严格状态机，防止 Agent 跳过关键步骤
- DAG 依赖图，控制任务执行顺序
- `spec_needed` 细分状态，在 Backlog 列中以 Needs Spec 标签收集和补充任务规格
- 执行契约：Context Package + Acceptance Criteria + DoD + Constraints
- Task Run 历史，记录每次执行尝试的结果

#### 方法手段

参见 §2.6 Task 对象设计。

**关键设计点**：

1. **spec_needed 状态**：借鉴 Hermes 的 triage 思路，但不做独立列；原始想法进入 Backlog 列并标记 Needs Spec，specifier 补充完整规格后 promote 到 ready。

2. **依赖自动推进**：当 blockedBy 的 task 变为 done，自动将被阻塞的 task 推进到 ready。

3. **Optimistic Lock**：状态变更使用 CAS（Compare-and-Swap），防止并发冲突。

4. **Run 历史**：每次 in_progress → 终态的变化记录一条 TaskRun：

```typescript
interface TaskRun {
  id: string;
  taskId: string;
  agentId: string;
  outcome: "completed" | "failed" | "blocked" | "cancelled";
  summary: string; // 结构化交付摘要
  metadata: Record<string, unknown>; // 结构化交付数据
  error?: string;
  startedAt: Date;
  endedAt?: Date;
}
```

#### 验收标准

- [ ] 完整 10 态状态机，非法转换 422
- [ ] Backlog 列中可显示并筛选 `spec_needed` / Needs Spec 卡片
- [ ] Task dependsOn 依赖图的创建、循环检测、自动推进
- [ ] Task assigned 后自动生成 Context Package（见 §3.4）
- [ ] Task done 条件：PR merged + CI passed + Approval granted
- [ ] Optimistic lock 并发安全
- [ ] Task Run 历史可查询

---

### 3.3 路线三：沟通与知识库体系

#### 来源

融合 agencycli 的 Inbox 闸门 + Molecule 的分层记忆 + 终极规划的 Thread/Decision/Document 体系。

#### 设计意图

知识不是 Agent 一次性读到的 prompt，而是一个分层、可检索、可沉淀的系统。Thread 摘要 + Decision 记录 + Document 体系 + Knowledge 分层检索 = 完整的知识闭环。

#### 功能目的

**沟通维度**：

- Thread 摘要：解决"聊天太长，Agent 噪音过载"问题
- Decision 记录：解决"结论消失在聊天里"问题
- Agent Inbox：解决"Agent 不知道有人找它"问题

**知识维度**：

- Document 体系：PRD / TDD / Test Plan / Runbook 统一状态机
- Knowledge Layer：分层检索（agent scope / workspace scope / global scope）
- 知识沉淀：Task 完成 → 提取经验 → 写入 Knowledge

#### 方法手段

**Inbox 通知触发矩阵**：

| 触发事件            | Inbox 类型        | 收件人           |
| ------------------- | ----------------- | ---------------- |
| Task assigned       | task_assigned     | owner            |
| @mention in comment | mention           | 被 @ 的人/Agent  |
| Review requested    | review_requested  | reviewer         |
| Approval required   | approval_required | approver (human) |
| Task blocked        | blocked           | owner + approver |
| Thread new message  | thread_update     | 订阅者           |

**Knowledge 分层**：

```
检索优先级：
1. Task 相关的 Decision（关联 Decision）
2. 同一 workspace 的 Knowledge Entry
3. Global Knowledge Entry
```

```typescript
interface KnowledgeEntry {
  id: string;
  scope: "agent" | "workspace" | "global";
  kind: "decision" | "project_archive" | "user_preference" | "runbook" | "learning" | "artifact";
  title: string;
  summary: string;
  body: string;
  tags: string[];
  sourceRefs: string[]; // 来源：Thread / Document / Task
  status: "active" | "stale" | "conflict" | "archived";
  ownerAgentId?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

#### 验收标准

- [ ] Thread 消息 > 10 条自动生成摘要；Thread resolved 生成最终摘要
- [ ] 用户/Agent 可以从 Thread 创建 Decision（提出→采纳→废弃→取代）
- [ ] 文档支持 6 种类型 + 5 态状态机
- [ ] Agent 执行 Task 前自动检索关联 Decision + Document 摘要
- [ ] Knowledge 支持分 scope 检索（agent / workspace / global）
- [ ] Task 完成经验可沉淀为 Knowledge Entry（learning kind）
- [ ] Agent Inbox 包含 assigned tasks / mentions / review requests / blocked items

---

### 3.4 路线四：Agent Orchestrator 编排器

#### 来源

融合 Hermes 的 Dispatcher 理念 + 终极规划的"Agent Orchestrator"（L3 层）+ Paseo 持久会话模型。

#### 设计意图

Agent Orchestrator 是系统的"调度中枢"——不是 Hermes 那样的 spawn 子进程 Dispatcher，而是在 Paseo 持久会话模型上的 **上下文编排 + 路由 + 策略执行** 层。

**Orchestrator ≠ 中央 Dispatcher**：Hermes 的 Dispatcher 负责 spawn 子进程（不适用于 Paseo 的持久会话）。Orchestrator 负责：

1. 构建 Context Package（任务上下文）
2. 路由任务到最合适的 Agent（基于 role/capability/负载）
3. 触发 Plan 审批流
4. 协调 multi-agent handoff

#### 功能目的

- Context Package 构建：避免 Agent 看到无关信息，防止上下文爆炸
- Agent 路由：基于 role/capability/currentLoad 选择最佳 Agent
- Plan 审批流编排：高风险 Plan → Reviewer → Human Approval
- Handoff 协调：Agent A 交付物 → Agent B 的 Context Package 输入

#### 方法手段

**Context Package 构建流程**：

```
Task status → assigned
  → Orchestrator.constructContextPackage(taskId)
    → Step 1: 检索相关 Document → 取摘要（非全文）
    → Step 2: 检索相关 Thread → 取 Thread Summary
    → Step 3: 检索相关 Decision → 取决策摘要
    → Step 4: 检索父任务交付物 → 取 run.summary + run.metadata
    → Step 5: 检索相关代码路径 → 取文件树 + 接口定义
    → Step 6: 组合 → 注入 Agent turn context
    → Step 7: 大小检查 → 不超过 Agent.maxContextTokens
       → 超出时按优先级截断：
          Task 定义 > 约束 > 验收标准 > 线程决策 > 代码 > 背景文档
```

**Agent 路由策略**：

```
1. 精确匹配：role 匹配 → 优先
2. 能力匹配：capabilities 包含所需标签
3. 负载均衡：currentLoad 最低的优先
4. 排除：已分配、offline、blocked 的 Agent
```

#### 验收标准

- [ ] Task assigned 后自动生成 Context Package
- [ ] Context Package 大小不超过 Agent.maxContextTokens
- [ ] Context Package 内容按优先级截断
- [ ] Agent 路由返回合适 Agent 列表（按匹配度排序）
- [ ] Handoff 上下文中包含上一个 Agent 的交付物摘要

---

### 3.5 路线五：Meta-Agent 知识与自进化

#### 来源

融合 Hermes Curator 理念 + 终极规划的"沉淀知识库"。

#### 设计意图

系统不仅在单次任务中帮助 Agent，还要跨任务积累经验。成功的模式沉淀为 Skill/Learning，失败的教训记录为 Improvement Note。不是独立的 Curator Agent，而是嵌入到任务闭环中的轻量自进化机制。

#### 功能目的

- Task 成功 → 提取可复用的经验 → 写入 Knowledge（learning kind）
- Task 失败 → 分析原因 → 写入 Improvement Note
- 知识卫生：定期标记 stale 和 conflict 的 Knowledge Entry
- 技能沉淀：多次成功的相似模式 → 可复用 Skill

#### 方法手段

**触发时机**：

| 事件                              | 产出                     | Kind            |
| --------------------------------- | ------------------------ | --------------- |
| Task done（经过 Review Approved） | success pattern 草稿     | learning        |
| Task 失败后 retry 成功            | "下次遇到 X 先做 Y" 草稿 | learning        |
| Task blocked 原因分析             | 阻塞原因 + 解决建议      | learning        |
| Project 完成                      | Project Archive          | project_archive |
| 新决策产生                        | Decision → ADR           | decision        |

**知识卫生**：

```
定期任务（可配置）:
  → 扫描超过 30 天未被引用的 Knowledge Entry → 标记 stale
  → 扫描内容冲突的 Knowledge Entry → 标记 conflict
  → 扫描 superseded 的 Decision → 确保相关 Task 不引用
```

#### 验收标准

- [ ] Task done（Review Approved）后自动提取 success pattern 草稿
- [ ] Task 失败后 retry 成功时生成 improvement note
- [ ] Knowledge Entry 支持 stale / conflict / archived 状态
- [ ] 不引入独立 Curator Agent——嵌入 Task 闭环中
- [ ] 所有自动生成的 Knowledge Entry 标记为 draft，需 Human 确认后 active

---

### 3.6 路线六：Polymorphic Actor 多态协作

#### 来源

融合 Multica 的 Polymorphic Actor 模型 + 终极规划的"Agent 作为团队成员"。

#### 设计意图

系统不区分"人做的"和"Agent 做的"。所有操作记录使用 actor_type + actor_id 统一模型。Agent 可以创建 Task、发评论、被 @、被订阅、有 inbox——和人的操作能力对等（除了审批）。

#### 功能目的

- 统一的 Actor 模型：减少代码分支，简化权限检查
- Agent 在 UI 上和人的交互一致：头像、名字、状态
- @mention Agent 自动创建 task
- 统一的 Activity Feed：人和 Agent 的行为在同一时间线展示

#### 方法手段

所有涉及"谁做了什么"的字段统一为：

```typescript
type Actor = {
  actorType: "human" | "agent" | "system";
  actorId: string;
};

// 应用到：
// Message.author
// Task.owner / Task.creator
// Comment.author
// Review.reviewer
// Approval.requestedBy / Approval.approvedBy
// TraceEvent.actor
```

**@mention 自动任务触发**：

```
消息中包含 "@agent-name"
  → 解析 mention
  → 创建 task（类型 mention_response）
  → 关联到被 @ 的 Agent
  → Agent inbox 收到通知
  → Agent 下一轮 turn 时处理
```

#### 验收标准

- [ ] 所有协作对象使用统一的 Actor 模型
- [ ] @mention Agent 自动创建 task 并通知
- [ ] Activity Feed 混合展示人类和 Agent 的行为
- [ ] Agent 在 inbox 中可以看到所有人的 @ 和分配

---

### 3.7 路线七：Autopilot 自主工作引擎

#### 来源

融合 Multica 的 Autopilot 模型 + 终极规划的定时/事件驱动工作流。

#### 设计意图

不是所有工作都是人触发的。Autopilot 提供声明式规则，让 Agent 在特定时间或特定事件发生时自动开始工作。与 Agent 的主动 inbox/claim 互补——Autopilot 是"外部触发"，inbox/claim 是"Agent 内驱"。

#### 功能目的

- Schedule 触发：每天早上的 Bug Triage、每周五的 Progress Report
- Webhook 触发：GitHub PR opened → 创建 Review Task
- Event 触发：Task completed → 自动创建下游 Task
- 并发策略：skip（跳过）/ queue（排队）/ replace（替换）

#### 方法手段

```typescript
interface Autopilot {
  id: string;
  title: string;
  assigneeType: "agent" | "role"; // 指定 agent 或指定 role（自动选最优）
  assigneeId?: string;
  roleId?: string;

  executionMode: "create_task" | "send_message";
  // create_task: 创建 Task → 走正常流程
  // send_message: 发消息到 Channel → @agent 讨论

  taskTemplate?: {
    title: string; // 支持 {{date}}
    body?: string;
    priority: number;
    channelId?: string;
  };

  triggers: {
    kind: "schedule" | "webhook" | "event";
    cronExpression?: string;
    timezone?: string;
    webhookUrl?: string;
    eventType?: string;
  }[];

  concurrencyPolicy: "skip" | "queue" | "replace";
  enabled: boolean;
}
```

**内置 Autopilot 模板**：

| 模板               | Cron           | 执行模式     | Assignee          |
| ------------------ | -------------- | ------------ | ----------------- |
| Bug Triage         | 0 9 \* \* 1-5  | create_task  | role: QA          |
| PR Review Reminder | 0 10 \* \* 1-5 | create_task  | role: Reviewer    |
| Weekly Report      | 0 17 \* \* 5   | send_message | role: Coordinator |
| Security Scan      | 0 2 \* \* 0    | create_task  | role: Security    |

#### 验收标准

- [ ] 支持 Schedule / Webhook / Event 三种触发方式
- [ ] 支持 create_task 和 send_message 两种执行模式
- [ ] 并发策略 skip/queue/replace 生效
- [ ] 内置 4 个模板可一键创建
- [ ] Autopilot 运行记录可查询
- [ ] Autopilot 创建的 Task 带 originType = 'autopilot'

---

### 3.8 路线八：Skill 与上下文注入

#### 来源

融合 Multica 的 Skill concept + 终极规划的 Context Package + Paseo 的 turn-based 模型。

#### 设计意图

Skill 是可复用的领域知识文档。不是 daemon 注入到 provider 原生路径（Multica 的方式），而是作为 Knowledge Entry 的特殊 kind——Agent 在 Context Package 中检索到并作为上下文注入到 turn。

#### 功能目的

- 领域知识模板化：部署流程 SOP、代码审查清单、UI 设计规范
- Context Package 自动检索：Task 相关 Skill → 注入 Agent turn
- Skill 从成功 Task 中沉淀（见 §3.5）
- Skill 有独立状态机（draft → verified → deprecated）

#### 方法手段

Skill = Knowledge Entry 的 kind='artifact' 或 kind='runbook'，特殊标记：

```typescript
interface Skill extends KnowledgeEntry {
  kind: "artifact" | "runbook";
  skillStatus: "draft" | "verified" | "deprecated"; // 独立于 Knowledge 的 active/stale/archived
  applicableRoles: string[]; // 适用于哪些 role
  applicableCapabilities: string[]; // 适用于哪些 capability
  usageCount: number; // 被引用次数
  lastUsedAt?: Date;
}
```

**Context Package 检索 Skill**：

```
Task.type = 'feature' + Task.owner.role = 'Developer'
  → 搜索 kind='artifact'/'runbook' + skillStatus='verified'
  → 匹配 applicableRoles 包含 owner.role
  → 按 usageCount 排序取前 3 个
  → 注入 Context Package
```

#### 验收标准

- [ ] Skill 作为 Knowledge Entry 的特殊子类型存在
- [ ] Task Context Package 自动包含匹配的 Skill 摘要
- [ ] Skill 从 Task done（Review Approved）中沉淀
- [ ] Skill 状态机：draft → verified → deprecated
- [ ] MVP 阶段至少 3 个预置 Skill 模板

---

## 四、MVP 功能范围定义

### 4.1 MVP 包含

| 层级            | 功能                                                          | 优先级 |
| --------------- | ------------------------------------------------------------- | ------ |
| L1 协作层       | Channel + Thread + 3 Agent（Coordinator, Product, Architect） | P0     |
| L1 协作层       | Agent Profile（含 role + capabilities）                       | P0     |
| L2 对话引擎     | 消息意图分类（chat / task / goal）                            | P1     |
| L2 对话引擎     | Thread 摘要自动生成                                           | P1     |
| L3 编排器       | Task assigned → Context Package 生成                          | P1     |
| L4b Task Engine | 10 态状态机 + 5 列看板映射 + Needs Spec 细节态                | P0     |
| L4b Task Engine | Task DAG 依赖图                                               | P1     |
| L6 审计         | 基础 Audit Log（Task 创建/状态变更关键路径）                  | P0     |
| L7 审批         | 基础 Approval（task_execution 审批）                          | P1     |
| 路线一          | Agent Profile 含 role/capabilities                            | P0     |
| 路线二          | Task 10 态状态机                                              | P0     |
| 路线三          | Thread + Decision + Inbox                                     | P1     |
| 路线六          | Polymorphic Actor 模型                                        | P0     |
| 路线七          | Autopilot Schedule 触发（内置 2 模板）                        | P2     |

### 4.2 MVP 不包含

- Agent 自动执行代码（改代码 / 创分支 / 创 PR）—— Phase 2
- 完整 Trace 系统—— Phase 3
- Agent Orchestrator 完整版—— Phase 3
- Meta-Agent Curator—— Phase 4
- 多 workspace 支持—— Phase 4
- Webhook / Event Autopilot 触发—— Phase 4
- Skill 完整体系—— Phase 4

### 4.3 MVP 验收标准

```text
一个自然语言需求可以被转成：
  Thread 讨论 → Decision 记录 → Document 草案 → Task 拆解 → Task Board 任务

→ 文档从 Draft → Review → Approved
→ 任务从 Backlog → Spec Needed → Ready → Assigned
→ Agent 参与 Thread 讨论、追问、提建议
→ Agent 可以收到 Inbox 通知
→ 但不能自动改代码
```

---

## 五、验收标准总览

### 5.1 12 个对象验收矩阵

| 对象      | MVP                    | Phase 2         | Phase 3          | Phase 4        |
| --------- | ---------------------- | --------------- | ---------------- | -------------- |
| Channel   | ✅ 创建/删除/Agent入驻 | —               | —                | —              |
| Thread    | ✅ 创建/摘要生成/状态  | —               | —                | —              |
| Agent     | ✅ Profile + 权限边界  | ✅ 执行权限生效 | ✅ 负载均衡      | ✅ 完整角色库  |
| Decision  | ✅ 创建/状态机         | —               | ✅ 关联检索      | ✅ 知识卫生    |
| Document  | ✅ PRD/TDD + 状态机    | ✅ 全部 6 种    | ✅ 自动生成      | ✅ 知识沉淀    |
| Task      | ✅ 10态状态机          | ✅ DAG          | ✅ Context Pkg   | ✅ 自动调度    |
| Plan      | —                      | ✅ 生成/审批流  | ✅ Reviewer 预审 | ✅ 全风险覆盖  |
| PR/Code   | —                      | ✅ 分支/PR 创建 | ✅ CI 集成       | ✅ 完整 Git 流 |
| Review    | —                      | ✅ 分层审查     | ✅ Review Agent  | ✅ 全自动化    |
| Approval  | ✅ 基础审批            | ✅ 全部类型     | ✅ 超时机制      | ✅ 策略引擎    |
| Tool Call | ✅ 记录                | ✅ 权限检查     | ✅ 完整 MCP      | ✅ 外部集成    |
| Trace     | ✅ 关键路径            | ✅ 完整记录     | ✅ 可回放        | ✅ 全链路      |

### 5.2 8 条路线验收矩阵

| 路线                | MVP 核心        | Phase 2        | Phase 3          | Phase 4       |
| ------------------- | --------------- | -------------- | ---------------- | ------------- |
| 路线一 Agent身份    | Agent Profile   | 权限执行       | 负载均衡         | 完整角色库    |
| 路线二 Task引擎     | 10态状态机      | DAG+ContextPkg | Plan审批流       | 自动调度      |
| 路线三 沟通知识     | Thread+Decision | Document+Inbox | Knowledge检索    | 知识卫生      |
| 路线四 Orchestrator | —               | —              | Context Pkg 构建 | 完整编排      |
| 路线五 Meta-Agent   | —               | —              | —                | 自进化        |
| 路线六 Polymorphic  | Actor 模型      | @mention Task  | Activity Feed    | 全对象对齐    |
| 路线七 Autopilot    | —               | Schedule 2模板 | 全部 4 模板      | Webhook+Event |
| 路线八 Skill        | —               | —              | 3 预置 Skill     | Skill 沉淀    |

### 5.3 核心闭环验收

```
Phase 1 (MVP)：
  讨论 → 文档 → 任务 → 看板
  （chat → Decision/Document → Task Tree → Task Board）

Phase 2：
  讨论 → 文档 → 任务 → 执行 → Review
  （+ Agent 编码 → PR → Review）

Phase 3：
  讨论 → 文档 → 任务 → 执行 → Review → 合并
  （+ Context Package + Plan 审批 + PR Merge）

Phase 4：
  讨论 → 文档 → 任务 → 执行 → Review → 合并 → 沉淀
  （+ Knowledge 沉淀 + Skill 复用 + 自动调度）
```
