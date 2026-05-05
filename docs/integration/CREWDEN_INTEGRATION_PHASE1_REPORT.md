# Paseo × Crewden Integration Phase 1 完成报告

> 日期：2026-05-04  
> 状态：✅ 已完成（按 V2 Phase1 目标）  
> 关联设计：`docs/integration/CREWDEN_INTEGRATION_DESIGN_V2.md`

---

## 一、阶段目标回顾（V2）

Phase 1 目标（V2）：

1. 将所有业务入口切到统一 `PaseoRuntimeService`
2. `legacy-local` 仅保留回滚能力，不再作为主链路散落调用
3. 完成 `runtimeInstanceId` 映射落地
4. 增加 runtime 状态与诊断能力
5. 保证端到端主流程可回归

---

## 二、本阶段交付结论

结论：**Phase 1 已完成**，并达到“主链路统一入口 + 迁移期双桥接 + 诊断可见 + 全量回归通过”。

核心成果：

1. 新增 `AgentRuntimeBridge` 抽象及两种实现：
   - `PaseoDaemonMode`
   - `LegacyLocalRuntimeAdapter`
2. 新增并启用 `PaseoRuntimeService` 作为唯一业务调用入口
3. `agents/messages/delegation/taskDelivery/internalAgent` 相关投递与启动路径改造完成
4. 新增 `/api/runtime/status`，Web Agent 面板展示 runtime 诊断信息
5. 全仓 `pnpm verify` 通过

---

## 三、代码交付与提交记录

主要代码提交（Crewden 仓库）：

1. `1668f6b`：`runtimeInstanceId` 字段与协议模型落地
2. `952efb6`：映射查询 API + mapper
3. `dfd3aef`：`internalAgent` DM 投递去耦（先行）
4. `63e3b4d`：Phase1 主体完成（统一服务迁移 + runtime 诊断）

Phase1 主提交：

- Commit: `63e3b4d`
- Message: `feat(runtime): complete Phase1 service migration and runtime diagnostics`
- 变更规模：20 files changed, 612 insertions(+), 92 deletions(-)

---

## 四、关键模块完成情况

### 4.1 统一运行时抽象（完成）

新增：

1. `packages/server/src/agent-runtime-bridge/types.ts`
2. `packages/server/src/agent-runtime-bridge/legacy-local-runtime-adapter.ts`
3. `packages/server/src/agent-runtime-bridge/paseo-daemon-mode.ts`
4. `packages/server/src/runtime/paseo-runtime-service.ts`

说明：

1. `PaseoRuntimeService` 统一封装 `start/stop/deliver/readWorkspace/status`
2. 配置支持：
   - `CREWDEN_RUNTIME_MODE`
   - 兼容 `CREWDEN_DAEMON_MODE`（迁移期）
   - `PASEO_DAEMON_URL` / `PASEO_DAEMON_API_KEY`
3. 默认目标是 `paseo-daemon`，未配置 Paseo 地址时自动回落 `legacy-local` 并给出 `fallbackReason`

### 4.2 业务入口迁移（完成）

已迁移为 runtime service 调用的主入口：

1. `packages/server/src/routes/agents.ts`
2. `packages/server/src/routes/messages.ts`
3. `packages/server/src/delegation.ts`
4. `packages/server/src/taskDelivery.ts`
5. `packages/server/src/routes/internalAgent.ts`（DM 投递链路）

迁移结果：

1. 主链路不再直接散落 `daemonRegistry.send(...)`
2. `daemonRegistry.send(...)` 留在 `legacy-local` 适配层与 `daemonSocket`（迁移期兼容）

### 4.3 runtime 诊断能力（完成）

新增后端接口：

1. `GET /api/runtime/status`
2. 文件：`packages/server/src/routes/runtime.ts`

新增前端展示：

1. `packages/web/src/api.ts` 增加 `getRuntimeStatus`
2. `packages/web/src/App.tsx` 加载 runtime 状态
3. `packages/web/src/components/AgentPanel.tsx` 展示 Runtime Diagnostics 卡片

### 4.4 `runtimeInstanceId` 映射持久化（完成）

完成项：

1. Agent 模型新增 `runtimeInstanceId`
2. DB schema 持久化 + 索引 `idx_agents_runtime_instance_id`
3. DB API：
   - `getAgentByRuntimeInstanceId`
   - `setAgentRuntimeInstanceId`
   - `clearAgentRuntimeInstanceId`
4. `RuntimeInstanceMapper` 已用于 Paseo 模式 agent 映射

---

## 五、与 V2 Phase1 验收标准对齐

### 验收项 1：生产默认路径走 Paseo Runtime

状态：✅ **达成（配置默认 + 可回落）**

说明：

1. 逻辑默认 `paseo-daemon` 模式
2. 若未配置 `PASEO_DAEMON_URL`，自动回落到 `legacy-local`（迁移期保护）

### 验收项 2：legacy-local 仅显式开关启用

状态：✅ **达成**

说明：

1. 通过 `CREWDEN_RUNTIME_MODE=legacy-local` 或兼容变量显式启用
2. 主业务代码不直接耦合本地 daemon 实现细节

### 验收项 3：消息、委派、任务更新端到端可用

状态：✅ **达成**

说明：

1. 消息投递路径、委派路径、任务通知路径均已统一经过 runtime service
2. 回归测试通过（见第六节）

---

## 六、验证与测试证据

已执行并通过：

1. `pnpm --dir /Users/lijun/Documents/crewden --filter @crewden/server typecheck`
2. `pnpm --dir /Users/lijun/Documents/crewden --filter @crewden/web typecheck`
3. `pnpm --dir /Users/lijun/Documents/crewden --filter @crewden/server test -- test/agentsApi.test.ts --bail=1`
4. `pnpm --dir /Users/lijun/Documents/crewden --filter @crewden/web test -- test/App.test.tsx --bail=1`
5. `pnpm --dir /Users/lijun/Documents/crewden verify`

测试结果：

1. 全 workspace typecheck 通过
2. 全 workspace test 通过
3. 新增 `/api/runtime/status` API 用例通过
4. Web mock 已补齐 `getRuntimeStatus`，无回归

---

## 七、已知迁移期保留项（非 Phase1 阻塞）

以下保留符合 V2“Phase1 允许短暂兼容”的定义：

1. `daemonSocket.ts` 仍承载 legacy daemon 通道事件处理
2. `legacy-local` 适配器仍存在，作为回滚路径
3. `PaseoDaemonMode.readWorkspace()` 当前返回 501（Phase2/3完善）

---

## 八、Phase2 建议启动清单

1. 删除旧 runtime 主链路模块（按 V2 切换清单）
2. 清理 `daemonRegistry` 与 `daemonSocket` 的生产依赖路径
3. 补齐 Paseo 模式 workspace 读取能力
4. 扩展 MCP 工具联调并完成单 runtime 收敛验证

---

## 九、报告结论

**Phase1 已完成并通过验证，可进入 Phase2（旧 runtime 删除与单 runtime 收敛阶段）。**
