# 面向 AI Agent 的协作式研发操作系统 —— 完整设计方案

> 基于「Slack-like 面向 AI Agent 的协作式研发操作系统方案」终极规划，
> 参考 agencycli / Hermes Kanban / Multica 等项目的设计经验，
> 在 Paseo × Crewden 整合基础上自主设计。
>
> 日期：2026-05-04

---

## 零、目标定位

```text
Slack-like Agent Collaboration OS
  + Task Board Execution Engine
  + Code / Doc / Review Toolchain
```

> **不要把 Agent 当成孤立的自动写代码工具，而是把它设计成"团队成员 + 工作流节点 + 工程执行器"。**

核心闭环：

```text
讨论 → 文档 → 任务 → 执行 → Review → 合并 → 沉淀
```

---

## 一、设计原则（基于终极规划修订版）

以下原则替换 Crewden 原有设计哲学中与终极规划不一致的部分。

### 原则 1：Agent 是有明确身份、职责、权限边界的团队成员

> 每个 Agent 必须有明确角色、职责、能力、权限边界和审批要求。不要求部门/汇报线/组织架构图，但角色定义和权限边界是硬约束。

这与 Crewden 原 v1.0 "轻角色" 的区别：**角色不仅是"适合做什么"，更是"允许做什么"和"不允许做什么"**。

### 原则 2：Chat 是协作入口，结构化对象是事实源

> 聊天是讨论和协作的入口，但不是唯一事实源。真正的事实源是：Task Board（任务状态）、Docs/ADR（正式方案）、Git（代码变更）、CI（测试结果）、Audit Log（权限记录）。

这与 Crewden 原 "chat-native goal alignment" 的区别：**Chat 负责过程，结构化对象负责结果。聊天内容可作为上下文来源，但不应直接代表最终决策。**

### 原则 3：Agent 可以自由讨论，但执行必须结构化

> 允许 Agent 在频道里自然语言讨论（高带宽、高灵活性），但输出和执行必须落到结构化对象：Requirement / Decision / Task / Plan / PR / Test Case / Release Note。

这与 Crewden 原原则 3 "结构只为协作" 的区别：**增加了"结构用于执行可靠性"的维度。**

### 原则 4：高风险动作必须 Human-in-the-loop

> 以下动作必须人工审批：删除数据、修改 schema、改权限系统、改支付/认证逻辑、合并主分支、部署生产、调用外部付费 API、访问敏感数据、大规模重构。

安全策略：`LLM 判断 + 规则引擎 + 权限系统 + 沙箱 + 人工审批`。

### 原则 5：Agent 不应拥有无限上下文 —— Context Budget 管理

> 每次任务执行前，系统必须构造 Context Package：任务定义 + 相关文档摘要 + 相关线程摘要 + 相关代码路径 + 约束 + 验收标准。不要把整个频道历史、整个 repo、所有文档都塞给 Agent。

### 原则 6：Review-first —— 所有 Agent 产物默认进入 Review

> Agent 输出 ≠ 完成的工作。Agent 输出 = 待审查的产物。只有 PR 合并 + 测试通过 + 验收通过，任务才 Done。

### 原则 7：Traceable Autonomy —— 每一次 Agent 行动可追溯

> 每一次 Agent 行动都可追溯、可回放、可审计。记录：谁触发、哪个 Agent 参与、读了什么上下文、调了什么工具、生了什么方案、谁批准、改了哪些文件、跑了哪些测试、最终 PR 是什么。

---

## 二、7 层系统架构

基于终极规划 + Paseo Runtime 基座，Crewden 升级为 7 层架构：

```
┌─────────────────────────────────────────────────────────────┐
│  L1: 协作层 — Slack-like Workspace                          │
│  Channels / Threads / DMs / Agent Profiles / Docs / Canvas  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  L2: 对话引擎 — Conversation Engine                         │
│  消息意图识别 / Thread 摘要 / 决策提取 / RAG 检索           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  L3: Agent 编排器 — Agent Orchestrator                      │
│  Router / Planner / Handoff / Policy / Context Package      │
└───────────────┬───────────────────────────────┬─────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│  L4a: Agent Runtime          │ │  L4b: Task Engine             │
│  Paseo Daemon (持久会话)     │ │  Kanban / Dependency / State  │
│  Role-based context injection│ │  Machine / Claim / Execution  │
└──────────────┬───────────────┘ └──────────────┬────────────────┘
               │                                │
               ▼                                ▼
┌─────────────────────────────────────────────────────────────┐
│  L5: 工具 / MCP 层 — Tool & MCP Layer                       │
│  Git / CI / Docs / Canvas / DB / Cloud / External Services  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  L6: 审计 & 观测层 — Audit & Observability                   │
│  Trace / Logs / Replay / Permissions / Approval Gate        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  L7: 审批 & 安全层 — Approval & Security Gate               │
│  Human-in-the-loop / Guardrails / Sandbox / Policy Engine   │
└─────────────────────────────────────────────────────────────┘
```

### L1 与 L2 的物理部署对应

```
L1: Crewden Web UI（React）—— 用户和 Agent 的共同工作界面
L2: Crewden Server（Go/Node.js 后端）—— 消息意图分类、摘要生成、决策提取
L3: Crewden Server（Go/Node.js 后端）—— 编排逻辑、Context Package 构建
L4a: Paseo Daemon —— Agent 生命周期、持久会话、上下文注入
L4b: Crewden Server —— 任务状态机、依赖图、Claim 机制
L5: MCP Bridge（Crewden）+ Paseo MCP Server —— 工具接入
L6: Crewden Server —— 审计日志、Trace 存储、权限记录
L7: Crewden Server + Paseo —— 审批流、Guardrails、沙箱策略
```

---

## 三、12 个核心系统对象

基于终极规划定义的核心对象，对应到 Crewden 数据模型：

### 3.1 对象总览

| 对象                 | 终极规划定义                      | Crewden 实现映射                  | 事实源       |
| -------------------- | --------------------------------- | --------------------------------- | ------------ |
| **Channel**          | 按领域划分的讨论空间              | 已有 Channel 模型                 | ✅           |
| **Thread**           | 聚焦讨论的线程上下文              | 已有 Thread 模型                  | ✅           |
| **Agent**            | 有角色/职责/权限的团队成员        | 需升级 Agent Profile（见 §3.2）   | ✅           |
| **Decision**         | 显式的架构决策记录（ADR）         | 需新增（见 §3.3）                 | Docs         |
| **Document**         | PRD / TDD / Runbook 等工程文档    | 需新增 Document 模型（见 §3.4）   | Docs         |
| **Task**             | Agent 的执行契约                  | 需升级 Task 模型（见 §3.5）       | Task Board   |
| **Plan**             | 每个 Task 的 Implementation Plan  | 需新增 Plan 对象（见 §3.6）       | Task Context |
| **PR / Code Change** | Git branch + PR                   | 通过 Git 集成追踪                 | Git          |
| **Review**           | 分层审查：Self → Reviewer → Human | 已有 v1.4 规划，需加强（见 §3.7） | Task Board   |
| **Approval**         | 高风险操作的显式审批节点          | 需新增 Approval Gate（见 §3.8）   | Audit        |
| **Tool Call**        | Agent 调用外部工具的记录          | 已有 MCP bridge，需加审计         | Audit        |
| **Trace**            | 全链路可追溯的执行记录            | 需新增 Trace 系统（见 §3.9）      | Audit        |

### 3.2 Agent 对象（升级版）

```typescript
interface AgentProfile {
  // === 身份 ===
  id: string;
  name: string;
  displayName: string;
  avatar: string;
  provider: string; // claude | codex | opencode | pi

  // === 角色与职责 ===
  role: string; // Product | Architect | Developer | QA | Reviewer | Security | DevOps | Documentation
  responsibilities: string[]; // 长期职责描述
  capabilities: string[]; // 可匹配能力标签：requirements, coding, review, testing, security, deployment, docs

  // === 权限边界（硬约束）===
  permissions: {
    readChannels: string[]; // 可读哪些频道
    writeChannels: string[]; // 可写哪些频道
    createDocs: boolean; // 可创建文档
    createTasks: boolean; // 可创建任务
    createBranches: boolean; // 可创建 Git 分支
    createPRs: boolean; // 可创建 PR
    mergeToMain: boolean; // 可合并主干 —— 默认 false
    deployToProd: boolean; // 可部署生产 —— 默认 false
    accessSensitiveData: boolean; // 可访问敏感数据
    callExternalAPIs: string[]; // 可调用的外部 API 列表
  };

  // === 工作风格 ===
  workingStyle: "execution" | "planning" | "reviewing" | "researching";
  handoffPreference: string; // 交接时需要什么输入
  constraints: string[]; // 明确不能做的事

  // === 上下文限制 ===
  maxContextTokens: number; // 上下文预算上限
  requiresApprovalFor: string[]; // 哪些操作需要审批

  // === 运行时 ===
  status: "online" | "offline" | "working" | "idle" | "blocked";
  currentLoad: number;
  lastActiveAt: Date;
}
```

### 3.3 Decision 对象（ADR）

```typescript
interface Decision {
  id: string;
  channelId: string;
  sourceThreadId: string; // 哪个线程产生的决策
  title: string; // 决策标题
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  context: {
    problem: string; // 要解决的问题
    alternatives: string[]; // 考虑的替代方案
    decision: string; // 最终决策
    rationale: string; // 决策理由
    consequences: string[]; // 决策影响
  };
  participants: {
    // 谁参与了决策
    actorType: "human" | "agent";
    actorId: string;
    role: string;
  }[];
  relatedDecisions: string[]; // 关联的 ADR id
  supersededBy?: string; // 被哪个新决策取代
  createdAt: Date;
  acceptedAt?: Date;
}
```

### 3.4 Document 对象

```typescript
type DocumentKind = "prd" | "tdd" | "adr" | "rfc" | "test_plan" | "runbook" | "postmortem";

interface Document {
  id: string;
  kind: DocumentKind;
  title: string;
  status: "draft" | "in_review" | "approved" | "deprecated" | "superseded";
  content: string; // Markdown
  sourceThreadId?: string; // 从哪个线程生成
  sourceChannelId: string;
  author: {
    actorType: "human" | "agent";
    actorId: string;
    name: string;
  };
  reviewers: {
    actorType: "human" | "agent";
    actorId: string;
  }[];
  relatedDecisions: string[]; // 关联的 ADR
  relatedTasks: string[]; // 关联的 Task
  supersededBy?: string; // 被哪个新文档取代
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
}
```

### 3.5 Task 对象（升级版 —— Task as Execution Contract）

```typescript
type TaskStatus =
  | "backlog"
  | "spec_needed" // 需要补充规格 —— Backlog 列中的 Needs Spec 细节态
  | "ready" // 已就绪
  | "assigned" // 已分配
  | "in_progress" // 执行中
  | "in_review" // 审查中
  | "changes_requested" // 需要修改
  | "qa" // QA 验证
  | "done" // 完成
  | "cancelled";

interface Task {
  id: string;
  title: string;
  type: "feature" | "bug" | "chore" | "research" | "docs";

  // === 来源追溯 ===
  sourceChannelId: string;
  sourceThreadId?: string;
  sourceGoalId?: string;
  sourceDocumentId?: string; // 从哪个 PRD/TDD 生成

  // === 执行契约 ===
  owner: {
    actorType: "human" | "agent";
    actorId: string;
  };
  reviewer: {
    actorType: "human" | "agent";
    actorId: string;
  };
  approver: {
    actorType: "human";
    actorId: string; // 审批者必须是人类
  };

  // === 状态 ===
  status: TaskStatus;
  priority: "P0" | "P1" | "P2" | "P3";

  // === 依赖 ===
  dependsOn: string[]; // task id 列表
  blockedBy: {
    taskId?: string;
    reason?: string;
  }[];

  // === 约束 ===
  acceptanceCriteria: string[]; // 验收标准
  definitionOfDone: string[]; // DoD：测试/文档/PR/安全扫描
  constraints: string[]; // 执行约束：不修改 public API / 不引入新依赖
  maxRuntimeMinutes?: number; // 超时限制

  // === 上下文 ===
  contextPackage?: ContextPackage; // 执行前生成的上下文包
  relevantDocs: string[]; // 关联文档 id
  relevantDecisions: string[]; // 关联决策 id

  // === 执行记录 ===
  implementationPlan?: Plan;
  runs: TaskRun[]; // 执行尝试历史
  branchName?: string; // Git 分支
  prUrl?: string;

  // === 审批记录 ===
  approvals: Approval[];

  createdAt: Date;
  updatedAt: Date;
  assignedAt?: Date;
  completedAt?: Date;
}
```

### 3.6 Context Package

```typescript
interface ContextPackage {
  task: {
    id: string;
    title: string;
    acceptanceCriteria: string[];
    constraints: string[];
    definitionOfDone: string[];
  };

  relevantDocs: {
    id: string;
    kind: DocumentKind;
    title: string;
    summary: string; // 摘要（非全文）
  }[];

  relevantThreads: {
    threadId: string;
    summary: string; // 线程摘要（非全文）
    keyDecisions: string[];
  }[];

  relevantCode: {
    paths: string[]; // 相关代码路径
    summary: string; // 代码结构摘要
  }[];

  parentTaskResults: {
    // 依赖任务的交付物
    taskId: string;
    summary: string;
    metadata: Record<string, unknown>;
  }[];

  constraints: string[];
  approvalRequired: boolean; // 是否需要审批才能开始
  callableTools: string[]; // 可调用工具列表
}
```

### 3.7 Plan 对象

```typescript
interface Plan {
  id: string;
  taskId: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  content: {
    approach: string; // 技术方案
    steps: {
      description: string;
      verification: string; // 如何验证这一步完成
      estimatedTools: string[];
    }[];
    risks: {
      description: string;
      mitigation: string;
    }[];
    filesToModify: string[]; // 预计修改的文件
    filesToCreate: string[];
    testsToAdd: string[];
  };
  author: {
    actorType: "agent"; // Plan 总是 agent 生成的
    actorId: string;
  };
  reviewer?: {
    actorType: "human" | "agent";
    actorId: string;
    approved: boolean;
    comment?: string;
  };
  createdAt: Date;
}
```

### 3.8 Approval 对象

```typescript
type ApprovalType =
  | "task_execution" // 开始执行任务
  | "architecture_decision" // 架构决策
  | "pr_merge" // 合并 PR
  | "deploy_staging"
  | "deploy_production"
  | "data_modification" // 修改数据
  | "schema_change" // 修改 schema
  | "external_api_call" // 调用外部付费 API
  | "sensitive_data_access"; // 访问敏感数据

interface Approval {
  id: string;
  type: ApprovalType;
  targetId: string; // task / pr / decision id
  status: "pending" | "approved" | "rejected" | "expired";
  requestedBy: {
    actorType: "agent";
    actorId: string;
  };
  approvedBy?: {
    actorType: "human";
    actorId: string;
  };
  reason: string; // 为什么需要审批
  context: string; // 审批上下文（简述让审批人理解）
  requestedAt: Date;
  respondedAt?: Date;
  expiresAt?: Date; // 超时自动拒绝
  comment?: string;
}
```

### 3.9 Trace 对象

```typescript
interface TraceEvent {
  id: string;
  traceId: string; // 一次完整出任务的 trace id
  taskId: string;
  spanId: string; // 一个步骤的 span id
  parentSpanId?: string;
  eventType:
    | "task_assigned"
    | "context_package_generated"
    | "plan_generated"
    | "plan_approved"
    | "tool_call"
    | "tool_result"
    | "file_modified"
    | "file_created"
    | "test_run"
    | "test_result"
    | "pr_created"
    | "review_submitted"
    | "approval_requested"
    | "approval_granted"
    | "task_completed"
    | "error";
  actor: {
    actorType: "human" | "agent" | "system";
    actorId: string;
  };
  detail: Record<string, unknown>;
  timestamp: Date;
}
```

---

## 四、推荐 Agent 角色配置（MVP → 完整版）

基于终极规划"容易失败的地方"警告，建议渐进式引入 Agent：

### 4.1 MVP（5 个 Agent）

| Agent           | Role        | 核心职责                     | 关键权限                                   |
| --------------- | ----------- | ---------------------------- | ------------------------------------------ |
| Coordinator     | Coordinator | 线程管理、意图识别、信息汇总 | 读所有频道，写消息                         |
| Product Agent   | Product     | 澄清需求、生成 PRD           | 读需求频道，写 PRD，不可改代码             |
| Architect Agent | Architect   | 架构方案、模块边界、ADR      | 读架构频道，写 TDD/ADR，不可改代码         |
| Developer Agent | Developer   | 编码实现                     | 读相关代码，创分支，创 PR，不可合并主干    |
| Reviewer Agent  | Reviewer    | 代码 Review、设计 Review     | 读所有代码，写 review 意见，不可直接改代码 |

### 4.2 扩展（+5 个 Agent）

| Agent               | Role          | 核心职责                       | 关键权限                                  |
| ------------------- | ------------- | ------------------------------ | ----------------------------------------- |
| QA Agent            | QA            | 测试计划、测试用例、回归验证   | 读相关代码，创测试分支，写测试            |
| Security Agent      | Security      | 权限、注入、敏感数据审计       | 读所有代码，写安全报告，不可以直接改代码  |
| DevOps Agent        | DevOps        | CI/CD、部署、环境配置          | 可运行 staging deploy，prod deploy 需审批 |
| Documentation Agent | Documentation | 文档沉淀、变更日志、知识库维护 | 可创建/修改文档                           |
| Planner Agent       | Planner       | 任务拆解、依赖分析、排期       | 可创建任务，不可执行任务                  |

---

## 五、三条端到端工作流

### 工作流 A：从需求到任务

```
1. 👤 PM 在 #product-requirements 发起需求消息
2. L2 Conversation Engine 识别为 goal-type 消息
3. 🤖 Product Agent 追问缺失信息（在 Thread 中）
4. 🤖 Architect Agent 初步判断技术影响，回复 Thread
5. 🤖 QA Agent 生成验收标准初稿
6. 👤 PM + 🤖 Coordinator 确认需求
7. 🤖 Documentation Agent 生成 PRD Draft
8. 👤 Tech Lead Review + Approve PRD
9. L3 Orchestrator 生成本次目标的 Decision 记录（存入 ADR）
10. 🤖 Planner Agent 拆解 Task Tree → 写入 Task Board
11. 👤 Tech Lead 审批 Task Tree 进入 Ready
```

### 工作流 B：从任务到代码

```
1. 🤖 Developer Agent 通过 inbox 发现 assigned Task
2. L3 Orchestrator 生成 Context Package：
   → 相关文档摘要（PRD/TDD）
   → 相关线程摘要 + 关键决策
   → 相关代码路径
   → 父任务交付物
   → 约束 + 验收标准
3. 🤖 Developer Agent 生成 Implementation Plan
4. 🤖 Reviewer Agent 预审 Plan：
   → 方案是否合理？风险点？是否影响其他模块？
5. 👤 Tech Lead 审批 Plan（高风险任务强制，低风险可配置跳过）
6. L7 Approval Gate 检查：是否所有审批节点已通过
7. 🤖 Developer Agent 创建 branch → 修改代码
8. 🤖 Developer Agent 运行单元测试
9. L6 Audit 记录：文件修改列表、工具调用记录
10. 🤖 Developer Agent 创建 PR
11. 🤖 Reviewer Agent 做自动 Review：
    → 是否符合需求？是否破坏架构边界？是否缺测试？是否有安全风险？
12. 👤 Human Reviewer 做最终 Review
13. 🔧 修改 → 再 Review → 通过
14. L7 Approval Gate：合并主干需要审批
15. 👤 Tech Lead Approve Merge
16. Task 状态自动从 changes_requested → done
17. L6 Audit：全链路 Trace 存档
```

### 工作流 C：分层 Review 机制

```
Layer 1: Agent Self Review
  → Developer Agent 在提交 PR 前自检
  → 检查：acceptance criteria 是否满足？测试是否通过？DoD 是否完成？

Layer 2: Specialized Review Agent
  → Reviewer Agent 自动扫描 PR
  → 检查：是否破坏架构边界？是否缺测试？是否有安全风险？改动范围是否过大？

Layer 3: CI / Static Analysis
  → 自动化：lint / typecheck / unit test / security scan

Layer 4: Human Review
  → Tech Lead / QA Lead 最终审查
  → 检查：是否符合需求？交互是否合理？是否引入技术债？

Layer 5: QA Verification
  → QA Agent 运行回归测试
  → 检查：是否影响已有功能？
```

---

## 六、Context Budget 管理设计

终极规划的原则 5 强调：**Agent 不应拥有无限上下文**。

### 6.1 Context Package 生成时机

```
Task status → assigned
  → L3 Orchestrator.constructContextPackage(taskId)
    → 检索：
      - 相关文档（PRD/TDD/ADR）→ getRelevantDocs(task)
      - 相关线程摘要 → getThreadSummary(sourceThreadId)
      - 相关代码路径 → getRelevantCodePaths(task)
      - 父任务交付物 → getParentResults(task.dependsOn)
    → 摘要化（而非全文）：
      - 文档：取标题 + 前 500 字 + key points
      - 线程：取 L2 生成的 Thread Summary
      - 代码：取文件树 + README + 接口定义
    → 大小检查：
      - 不超过 Agent.maxContextTokens
      - 超出时按优先级截断：Task 定义 > 约束 > 验收标准 > 线程决策 > 代码 > 背景文档
    → 注入到 Agent 的 Paseo turn context
```

### 6.2 摘要生成（L2 Conversation Engine）

```
每个 Thread 在以下时机自动生成摘要：
  - Thread 消息数 > 10 条
  - Thread 被标记为 resolved
  - 有人在 Thread 中显式请求摘要

Thread Summary 格式：
  {
    threadId: "REQ-1024",
    title: "增加 AI 自动生成任务拆解能力",
    participants: ["PM(👤)", "ProductAgent(🤖)", "ArchitectAgent(🤖)"],
    keyPoints: ["MVP 只支持单项目空间", "需人工审批后写入看板"],
    decisions: ["decision-001: 异步拆解，不阻塞聊天"],
    openQuestions: [],
    status: "resolved"
  }
```

---

## 七、三条关键设计原则的工程约束

终极规划强调了三句最关键的话：

### 7.1 "聊天负责协作，文档负责共识"

→ 工程约束：「任何频道中产生的实质性结论，必须显式记录为 Decision 或 Document。不允许"结论只在聊天里"。」

### 7.2 "任务负责执行，PR 负责代码事实"

→ 工程约束：「Task 的状态变更必须通过 Task Board API。不允许 Agent 在频道里说"我完成了"就算完成。Task done 的唯一路径是 PR merged + CI passed + Approval granted。」

### 7.3 "人类负责最终责任，Trace 负责审计"

→ 工程约束：「每个 Task 必须有一个 human approver。高风险操作（P0/P1 task execution, merge to main, deploy to prod）必须有显式审批记录。全链路 Trace 必须覆盖 Task 创建 → Context Package 生成 → Plan 审批 → 代码修改 → PR 创建 → Review → Merge。」

---

## 八、8 条参考路线与终极规划的最终对齐

基于终极规划重新评估 8 条路线：

| 路线                         | 终极规划对应                                                | 采纳级别    | 说明                                                                    |
| ---------------------------- | ----------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| **路线一** Org + Scheduler   | Agent Profile 中的角色/职责/权限 + Agent Orchestrator       | 🟢 升级采纳 | 不是 agencycli 的 Org Chart，而是 Agent 身份层（§3.2 + §4）             |
| **路线二** Task + OKR        | Task as Execution Contract（§3.5）+ Document 状态机（§3.4） | 🟢 升级采纳 | 不是 OKR，而是 Task 作为执行契约 + Document 作为事实源                  |
| **路线三** 沟通 + 知识库     | Thread + Decision + Context Package（§6）+ Knowledge        | 🟢 完全采纳 | 完美对齐：Thread → Decision → Context Package → Knowledge               |
| **路线四** Dispatcher        | Agent Orchestrator（L3）+ Task Engine（L4b）                | 🟢 升级采纳 | 不是 Hermes spawn 模型，而是 Paseo session 模型下的编排/路由/上下文组装 |
| **路线五** Curator           | Knowledge 维护 + Self-improvement                           | 🟡 延后     | P2 阶段做，先做知识沉淀再做自改进                                       |
| **路线六** Polymorphic Actor | Agent 作为团队成员（§3.2）+ 12 个对象全用 actor_type        | 🟢 完全采纳 | 核心基础——所有对象都是多态 actor                                        |
| **路线七** Autopilot         | Agent Orchestrator 的调度维度                               | 🟢 完全采纳 | Autopilot 作为 Orchestrator 的定时/事件触发维度                         |
| **路线八** Skill             | Context Package 中的 callable tools + knowledge 检索        | 🟢 调整采纳 | 不再是 daemon 注入，而是 Context Package 中的能力声明                   |

### 关键变化：从 Crewden 原哲学到终极规划对齐

| 原 Crewden 哲学            | 终极规划要求                        | 修订后                                      |
| -------------------------- | ----------------------------------- | ------------------------------------------- |
| 轻角色，不重组织           | Agent 有明确角色+权限边界           | ✅ 保留"不重组织"，新增强制"角色+权限"      |
| 目标从聊天中自然产生       | Chat 是协作入口，结构化对象是事实源 | ✅ 聊天仍是入口，但结论必须显式记录         |
| 结构只为协作引入           | 结构用于执行可靠性                  | ✅ 增加"执行契约"维度                       |
| Agent 自主性来自机制       | 自主性 + 可追溯 + 可审计            | ✅ 增加 Trace 和 Approval Gate              |
| Chat-native goal alignment | Chat 负责协作，Task Board 负责执行  | ✅ 入口仍是 Chat，但事实源转移到 Task Board |

---

## 九、实施路线图（基于 7 层架构）

### Phase 1：地基（P0）—— L1+L4b+L6

```
L1: 协作层 MVP
  → 频道 + 线程 + Agent 入驻频道
  → Agent Profile v1（角色 + 职责 + 初步权限）

L4b: Task Engine
  → Task 状态机升级（backlog → spec_needed → ready → ... → done）
  → 参考 Hermes 设计：spec_needed 细分状态 + 5 列看板映射 + 严格状态转换 + dependency graph
  → Task as Execution Contract 模型落地

L6: Audit
  → 基础 Audit Log（谁做了什么）
  → 关键路径 Trace（task创建→分配→状态变更）

交付标准：
  ✓ Agent 可以入驻频道、参与讨论
  ✓ Task 有严格状态机，不允许非法转换
  ✓ 所有 task 关键动作可审计
```

### Phase 2：身份 + 审批（P1）—— L2+L7

```
L2: Conversation Engine
  → 消息意图分类（chat / task / goal）
  → Thread 摘要自动生成
  → 决策提取 → Decision 对象落地

L7: Approval Gate
  → Approval 对象 + 状态机
  → 高风险操作审批流
  → Human-in-the-loop 机制

交付标准：
  ✓ Thread 超 10 条消息自动生成摘要
  ✓ 频道讨论可显式创建 Decision
  ✓ 高风险 task 执行前必须审批
```

### Phase 3：编排 + 上下文（P2）—— L3

```
L3: Agent Orchestrator
  → Context Package 自动生成
  → Plan 对象（agent 生成 → reviewer 预审 → human 审批）
  → Agent 发现/路由/委派

交付标准：
  ✓ Task assigned 后自动生成 Context Package
  ✓ Agent 生成 Implementation Plan → 进入审批流
  ✓ 完整 Plan-Execute-Verify 闭环
```

### Phase 4：执行 + 工具（P3）—— L4a+L5

```
L4a: Agent Runtime（Paseo）
  → Paseo turn-based 执行
  → Context Package 注入到 turn context
  → Role-based 上下文限制

L5: MCP Tool Layer
  → Git 操作（branch/create PR/merge）
  → CI 触发
  → 文档生成/更新
  → 外部服务集成（Figma, Jira, Notion）

交付标准：
  ✓ Agent 可以：创分支→改代码→跑测试→创 PR
  ✓ 所有工具调用有权限检查和审计记录
  ✓ Agent 不可直接合并主干
```

### Phase 5：知识 + 自进化（P4）—— Knowledge + Curator

```
Knowledge Layer
  → Document 状态机落地（draft→review→approved→deprecated→superseded）
  → Decision 系统（ADR）
  → Knowledge 分层搜索（agent/workspace/global）

Curator
  → 成功的 task → 可复用 skill draft 沉淀
  → 失败的 task → improvement note
  → 知识 hygiene（stale/conflict 标记）

交付标准：
  ✓ 项目完成后自动生成 Project Archive
  ✓ Task 完成经验可沉淀为 knowledge entry
  ✓ Agent 执行前自动检索相关知识
```

---

## 十、MVP 最小可行产品定义

基于终极规划的 Phase 1 建议：「先不让 Agent 自动改代码」，聚焦协作 + 文档 + 任务拆解。

### MVP 功能范围

| 层级           | MVP 包含                      | MVP 不包含                 |
| -------------- | ----------------------------- | -------------------------- |
| L1 协作层      | 频道、线程、Agent Profile、DM | Canvas、多 workspace       |
| L2 对话引擎    | 消息意图分类、Thread 摘要     | RAG 检索、全文搜索         |
| L3 编排器      | 任务分配                      | Context Package、Plan 对象 |
| L4 Task Engine | 严格状态机、DAG               | 自动 claim                 |
| L5 工具层      | MCP bridge（读操作）          | 写操作（改代码、PR）       |
| L6 审计        | 基础 audit log                | 全链路 Trace               |
| L7 审批        | 基础审批流                    | 复杂策略引擎               |

### MVP 验收标准

```text
一个自然语言需求可以被转成：
  PRD → 技术方案 → 任务树 → 验收标准 → 看板任务

→ 文档从 Draft → Review → Approved
→ 任务从 Backlog → Spec Needed → Ready
→ Agent 可以参与 Thread 讨论、追问、提建议
→ 但不能自动改代码
```

### MVP Agent 配置

只需 3 个 Agent：

- **Coordinator Agent**：线程管理、信息汇总
- **Product Agent**：需求澄清、PRD 生成
- **Architect Agent**：技术方案、任务拆解

---

## 十一、与现有 Crewden + Paseo 实现的关系

### 已就绪的能力（可以直接用）

| 能力                                  | 来源            | 对应终极规划层级 |
| ------------------------------------- | --------------- | ---------------- |
| Channel / Thread / DM / Agent Profile | Crewden v0.x    | L1 协作层        |
| Paseo Agent 生命周期管理              | Paseo Phase 0-4 | L4a Runtime      |
| MCP Bridge                            | Crewden v0.4.6  | L5 工具层        |
| Task Board                            | Crewden v0.6    | L4b（基础版）    |
| Reminders                             | Crewden v0.7    | 辅助             |
| Inbox + Reliable Delivery             | Crewden v0.4.4  | L3（部分）       |

### 需要改造的能力

| 能力          | 改造说明                              | 对应层级 |
| ------------- | ------------------------------------- | -------- |
| Agent Profile | 增加角色/职责/权限/上下文限制（§3.2） | L1       |
| Task 模型     | 升级为 Execution Contract（§3.5）     | L4b      |
| 状态机        | 从 3 态升级为 10 态                   | L4b      |
| 消息处理      | 增加意图分类 + Thread 摘要            | L2       |
| Audit         | 从零散日志到结构化 Trace              | L6       |

### 需要新增的能力

| 能力               | 设计      | 对应层级 |
| ------------------ | --------- | -------- |
| Decision 对象      | §3.3      | L2       |
| Document 对象      | §3.4      | L2       |
| Context Package    | §3.6 / §6 | L3       |
| Plan 对象          | §3.7      | L3       |
| Approval 对象      | §3.8      | L7       |
| Agent Orchestrator | §6        | L3       |
| Trace 系统         | §3.9      | L6       |
| Agent 权限模型     | §3.2      | L7       |
