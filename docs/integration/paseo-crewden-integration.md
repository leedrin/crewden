# Paseo × Crewden 整合方案

> 基于两个项目的深度分析，以下是系统性整合方案建议。

---

## 一、先理解两者的核心差异

| 维度              | Paseo                                   | Crewden                                        |
| ----------------- | --------------------------------------- | ---------------------------------------------- |
| **成熟度**        | v0.1.64，生产级质量，日更               | 早期 v0.x，功能完整但欠打磨                    |
| **Agent 协议**    | ACP（@agentclientprotocol/sdk），标准化 | 简单 Bridge 行解析，`[[CREWDEN_SEND_MESSAGE]]` |
| **进程模型**      | 持久会话 + Timeline 事件流              | One-shot 进程，每消息 spawn 一次               |
| **数据持久化**    | 文件级 JSON（`$PASEO_HOME`）            | 内存 Map → SQLite（规划中）                    |
| **客户端**        | iOS/Android/Web/Electron 全平台         | 仅 Web UI                                      |
| **协作层**        | Slock 规划中（Channel-first）           | 已有 Channel/DM/Task Board/Goal/Review         |
| **Provider 扩展** | ACP + Direct 双模式，完整               | 简单 CLI driver，无标准协议                    |
| **通信协议**      | WebSocket + 二进制多路复用 + Timeline   | WebSocket + JSON 文本协议                      |

**关键洞察：**

- Crewden 的协作层（Slock/Channel/Thread/Task/Goal/Review）比 Paseo 现有能力完整
- Paseo 的 Agent 运行时（ACP/Daemon/Multi-Provider/跨设备）比 Crewden 成熟得多
- 两者 WebSocket 层设计思路相似，可以对齐

---

## 二、方案一：Paseo 核心 + Crewden 协作 UI（最小改动）

**核心思路：** Crewden 不再维护自己的 Agent 运行时，而是作为 Paseo 的一个特殊 Client，利用 Paseo 的 ACP 协议接入，共享 Paseo Daemon。

```
Browser (Crewden Web UI)
    │  HTTP REST + WebSocket
    ▼
Paseo Daemon (Node.js)
    │  ACP Protocol
    ▼
CLI Agents: claude | codex | gemini (+ Crewden Bridge Extensions)
```

### Crewden 保留的部分

- Web UI（Channel/DM/Task Board/Goal/Review/Agent Profile）
- Server 协作逻辑（Channel/Message/Task/Goal/Review）
- Agent-facing CLI（`crewden` 命令）
- Cloudflare 部署方案

### Crewden 重用的部分

- 删掉 `packages/daemon` 和 `agentProcessManager`
- 删掉 `packages/server` 中的 Agent 运行时相关代码
- 复用 Paseo 的 `AgentManager` + ACP Provider

### Crewden Server 变成什么

```
Crewden Server（Fastify）
  → REST API：Channel/Message/Task/Goal/Review/Knowledge/AgentProfile
  → WebSocket Hub：Browser ←→ Server（协作状态推送）
  → Paseo Daemon 连接：用 DaemonClient 连接远程/本地 Paseo Daemon
  → ACP 适配层：把 Crewden 的 Task/Goal 路由到 Paseo ACP Agent
```

### Crewden Agent 如何对接 Paseo ACP

Crewden 的 Bridge 协议可以封装为 ACP 的一个工具集（Tool）：

```javascript
// Crewden ACP Bridge - 在 Paseo Agent 看来是另一个 MCP Tool Set
const CREWDEN_TOOLS = [
  { name: "crewden_send_message", ... },
  { name: "crewden_create_task", ... },
  { name: "crewden_delegate", ... },
  { name: "crewden_set_reminder", ... },
  { name: "crewden_search_knowledge", ... },
];
```

Agent 通过 `[[CREWDEN_TOOL:crewden_create_task]]` 或 MCP Tool Call 触发 Crewden 协作操作，结果通过 ACP 的 `Connection.sendMessage` 回传给 Crewden Server。

### 优点

- 实现最简单，利用已有组件
- Crewden 获得 Paseo 的多 Provider 支持（Claude/Codex/OpenCode/Copilot/Z.AI/Qwen）
- Paseo 获得 Crewden 的完整协作层（Channel/Goal/Review）
- 移动端、Web、桌面端全部继承

### 缺点

- Crewden 完全依赖 Paseo Daemon，失去独立部署灵活性
- 需要解决"一个机器上的 Paseo Daemon 如何同时服务多个 Crewden Channel/Project"的问题

### 迁移步骤

1. 在 Paseo 中实现 Crewden ACP Tool Set（22 个工具）
2. Crewden Server 去掉 `daemon/` 包，改用 DaemonClient 连接 Paseo
3. Crewden Web UI 保留 Channel/DM/Task Board/Goal/Review UI，替换 Agent Panel
4. Crewden CLI 降级为 Paseo CLI 的 wrapper

---

## 二（续）、方案一.B：Crewden 作为 Slock 实现

**核心思路：** 直接采纳 Paseo 现有的 Slock 设计文档，用 Crewden 的实现替换 Paseo 规划中的 Slock。

Paseo 的 `docs/SLOCK_ANALYSIS_AND_DESIGN.md` 已经详细分析了差距：

- Paseo 有 Agent 执行核心，缺 Channel-first UI + Thread + 控制平面
- Crewden 有 Channel/DM/Task Board，缺跨设备、Relay、持久会话

### Crewden → Slock 映射

| Slock 组件      | Crewden 已有？          | 需改造                          |
| --------------- | ----------------------- | ------------------------------- |
| Thread Inbox    | ✅ 已有 channel/message | 扩展为 Thread 聚合              |
| Message-to-Task | ✅ 已有 Task Board      | 扩展 As Task 交互               |
| 右侧控制平面    | ❌ 完全缺失             | 从头实现                        |
| 连接恢复        | ❌ 缺失                 | 实现 offline banner + reconnect |
| Surface 路由    | ❌ 缺失                 | 实现 Paseo ↔ Slock 切换         |

这样 Crewden 的 UI 层成为 Paseo 的 Slock 工作面，通过 WebSocket 与 Paseo Daemon 交互。

---

## 三、方案二：统一 ACP 协议层（中等改动）

**核心思路：** Crewden Daemon 升级为 ACP 兼容，实现与 Paseo 的协议互操作。两个项目各自保留完整栈，但通过 ACP 互通。

### 架构

```
Crewden Client (Web UI) ←→ Crewden Daemon（ACP 兼容）
                                  │
                          ACP Protocol
                                  │
                                  ▼
                          Paseo Daemon
                                  │
                          ACP Protocol
                                  ▼
                          Paseo Client (iOS/Android/Electron)
```

### Crewden 需要改造的部分

- Bridge 协议 → 升级为完整 ACP 协议栈
- 进程模型 → 持久会话（参考 Paseo Session）
- Provider 驱动 → 统一 ACP Provider 接口
- 数据层 → 迁移到 `$PASEO_HOME` 兼容结构（或共享）

### 统一的 ACP 协议，所有 Agent（Claude/Codex/OpenCode/Copilot）一致体验

### 优点

- 两个项目独立演进，互操作强
- Crewden 不依赖 Paseo，保持独立部署
- ACP 生态扩展，协议层价值最大化

### 缺点

- 改动量极大，涉及重写核心架构
- 两个项目的产品方向需要完全对齐
- 需要同时协调 Paseo 和 Crewden 两个维护者的路线图

---

## 四、方案三：完全合并（大改动）

**核心思路：** 将 Crewden 的所有组件（Server/UI/Daemon）完全并入 Paseo 代码库，作为 `packages/crewden` 子项目。

### 合并后的结构

```
paseo/
  packages/
    core/          ← 现有 Paseo 核心（Daemon/ACP/Agent）
    crewden/       ← Crewden 原 packages/
      server/      ← Crewden Server + 协作逻辑
      web-ui/      ← Crewden Web UI
      daemon/      ← Crewden Agent 运行时（重构）
  apps/
    ios/
    android/
    electron/
    web/           ← Crewden Web UI 集成
```

### 优点

- 统一代码库，零协议适配成本
- Crewden 的协作功能完整继承
- 维护成本最低，长期最优

### 缺点

- 改动量极大，跨项目合并复杂度高
- 两个项目的产品方向需要完全对齐
- 需要同时协调 Paseo 和 Crewden 两个维护者的路线图

---

## 五、方案对比

### 改动量

| 方案                            | 改动量 |
| ------------------------------- | ------ |
| 方案一：Paseo 核心 + Crewden UI | 小     |
| 方案二：统一 ACP 协议           | 中     |
| 方案三：完全合并                | 大     |

### 实现周期

| 方案                            | 实现周期 |
| ------------------------------- | -------- |
| 方案一：Paseo 核心 + Crewden UI | 4-6 周   |
| 方案二：统一 ACP 协议           | 8-12 周  |
| 方案三：完全合并                | 3-6 月   |

### 风险

| 方案                            | 风险 |
| ------------------------------- | ---- |
| 方案一：Paseo 核心 + Crewden UI | 低   |
| 方案二：统一 ACP 协议           | 中   |
| 方案三：完全合并                | 高   |

### Crewden 独立性

| 方案                            | Crewden 独立性  |
| ------------------------------- | --------------- |
| 方案一：Paseo 核心 + Crewden UI | 依赖 Paseo      |
| 方案二：统一 ACP 协议           | 保留独立 Daemon |
| 方案三：完全合并                | 完全合并        |

### Paseo 获得

| 方案                            | Paseo 获得       |
| ------------------------------- | ---------------- |
| 方案一：Paseo 核心 + Crewden UI | 完整协作 UI      |
| 方案二：统一 ACP 协议           | Crewden ACP 兼容 |
| 方案三：完全合并                | 全功能整合       |

### Crewden 获得

| 方案                            | Crewden 获得         |
| ------------------------------- | -------------------- |
| 方案一：Paseo 核心 + Crewden UI | ACP runtime + 多平台 |
| 方案二：统一 ACP 协议           | 协议互操作           |
| 方案三：完全合并                | 全部                 |

### 维护成本

| 方案                            | 维护成本   |
| ------------------------------- | ---------- |
| 方案一：Paseo 核心 + Crewden UI | 最低       |
| 方案二：统一 ACP 协议           | 中等       |
| 方案三：完全合并                | 统一后最低 |

### 典型场景

| 方案                            | 典型场景       |
| ------------------------------- | -------------- |
| 方案一：Paseo 核心 + Crewden UI | 快速上线 Slock |
| 方案二：统一 ACP 协议           | 渐进迁移       |
| 方案三：完全合并                | 长期蓝图       |

---

## 六、推荐路径

### 如果目标是快速让 Paseo 具备 Crewden 的协作能力

→ **方案一**，Crewden Web UI 接入 Paseo Daemon，6 周内可出 MVP

### 如果目标是将两个项目逐步融合

→ **方案二**，先让 Crewden Daemon 兼容 ACP，保留独立演进，同时逐步将 Crewden 协作 UI 迁移到 Paseo App

### 如果目标是从长远构建一个完整系统

→ **方案三**，分阶段：

1. **Phase 1**：方案一快速上线
2. **Phase 2**：方案二协议互操作
3. **Phase 3**：方案三完全合并

---

## ⚠️ 最关键的前提决策

> Paseo 是 BDFN 项目（一个人主导），Crewden 目前也基本是单维护者状态。这个整合是否以 Paseo 为主导、Crewden 作为功能模块接入，还是两者平等合并？这决定了方案的可行性。

---

需要我针对某个具体方案做更深入的技术设计吗？
