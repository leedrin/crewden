# Crewden 迭代路线图 — v2.x 扩展

> 本文档追加以「Slack-like 面向 AI Agent 的协作式研发操作系统」为目标的 v2.x 迭代规划。
> 每个版本有独立的实现计划文档，遵循 Crewden 现有文档格式，可直接发给 Claude Code 自主执行。
>
> 前置已完成：[v0.2 ~ v1.5.1](../ROADMAP.md)
> 整体设计：[Slack-like AI Agent 协作式研发操作系统完整设计](./SLACK_LIKE_AI_AGENT_DESIGN.md)
> 功能 PRD：[AI Agent 协作式研发操作系统 PRD](./SLACK_LIKE_AI_AGENT_PRD.md)
> 设计参考：[MultiCa 任务系统可行性调研](./multica-task-board-feasibility.md) — v2.0/v2.1/v2.7 可参考 MultiCa 的成熟设计

---

## v2.x 版本概览

| 版本 | 主题 | 核心交付 | 依赖 | MVP 阶段 |
|------|------|----------|------|----------|
| v2.0 | Polymorphic Actor + Task Contract | 统一 actor 模型，10 态状态机（5 列看板），triage 机制，基础 audit | v1.5.1 | Phase 1 地基 |
| v2.1 | Agent Identity v2 | Agent role / responsibilities / capabilities / permissions，Agent 匹配引擎，权限强制执行 | v2.0 | Phase 1 地基 |
| v2.2 | Decision & Document | Decision 对象（ADR 完整状态机），Document 对象（6 种类型 + 5 态状态机） | v2.0 | Phase 1 地基 |
| v2.2.1 | Project 多项目隔离 | Project 对象，多项目隔离边界，所有对象归属 project，侧边栏 Project Switcher | v2.2 | Phase 1 地基 |
| v2.3 | Thread Intelligence | Thread 摘要自动生成，消息意图分类（chat/task/goal），Agent Inbox v2 | v2.2.1 | Phase 2 |
| v2.4 | Context Package | Context Package 生成引擎，Context Budget 管理 | v2.3 | Phase 2 |
| v2.5 | Plan & Approval | Plan 对象 + 审批流，Approval 对象 + 完整状态机 | v2.4 | Phase 2 |
| v2.6 | Code Execution | Git 集成（branch/PR via MCP），分层 Review 工作流，PR-based 任务完成 | v2.5 | Phase 3 |
| v2.7 | Autopilot | Autopilot 引擎（schedule/webhook/event 触发），4 个内置模板 | v2.0 | Phase 3 |
| v2.8 | Knowledge Layer | Knowledge 分层检索（agent/workspace/global），Task → knowledge 沉淀，知识卫生 | v2.6 | Phase 4 |
| v2.9 | Full Trace | 全链路 Trace 系统（span-based），统一 Activity Feed | v2.5 | Phase 4 |
| v2.10 | Self-Evolution | Skill capture from tasks，轻量 improvement loop，知识冲突检测 | v2.8 + v2.9 | Phase 4 |

---

## v2.x 各版本独立实现文档索引

- [v2.0 — Polymorphic Actor + Task Contract](./v2.0-polymorphic-actor-task-contract.md)
- [v2.1 — Agent Identity v2](./v2.1-agent-identity-v2.md)
- [v2.2 — Decision & Document](./v2.2-decision-document.md)
- [v2.2.1 — Project 多项目隔离](./v2.2.1-project-isolation.md)
- [v2.3 — Thread Intelligence](./v2.3-thread-intelligence.md)
- [v2.4 — Context Package Engine](./v2.4-context-package.md)
- [v2.5 — Plan & Approval Gate](./v2.5-plan-approval.md)
- [v2.6 — Code Execution & Review](./v2.6-code-execution-review.md)
- [v2.7 — Autopilot Engine](./v2.7-autopilot.md)
- [v2.8 — Knowledge Layer](./v2.8-knowledge-layer.md)
- [v2.9 — Full Trace & Audit](./v2.9-trace-audit.md)
- [v2.10 — Self-Evolution](./v2.10-self-evolution.md)
