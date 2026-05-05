# Paseo × Crewden Integration Phase 3 完成报告

> 日期：2026-05-04  
> 状态：✅ 已完成（Phase 3）  
> 对齐文档：`docs/integration/CREWDEN_INTEGRATION_DESIGN_V2.md`

---

## 一、Phase 3 目标（V2）

Phase 3（Week 9-11）目标：

1. 协作闭环扩展与稳定化
2. 运行时异常可见、可恢复
3. 消息投递具备重试、幂等、死信记录能力
4. Gemini 在 Paseo 单 Runtime 模式下明确禁用，避免“在线但不可用”误导

---

## 二、本阶段交付

### 2.1 运行时支持治理（Gemini 显式禁用）

新增：

- `packages/server/src/runtime/runtime-support.ts`

能力：

1. 统一判断支持 runtime（`claude` / `codex`）
2. 对不支持 runtime（`gemini`）返回明确错误文案
3. 将不支持 runtime 的 agent 标记为 `error`，并写入 activity + audit log
4. 服务启动时执行一次不支持 runtime agent 状态收敛（reconcile）

改造：

- `packages/server/src/app.ts`
  - 启动阶段调用 `reconcileUnsupportedRuntimeAgents()`
- `packages/server/src/routes/agents.ts`
  - `POST /api/agents`：`gemini` 返回 `422`
  - `POST /api/agents/:id/start`：不支持 runtime 返回 `422` 并标记 agent 为 `error`

### 2.2 投递可靠性（重试 + 死信）

新增：

- `packages/server/src/runtime/delivery-reliability.ts`

能力：

1. `deliverWithRetry(...)`：固定重试退避（150ms/350ms）
2. 重试后仍失败写入死信审计：`runtime.dead_letter`

改造接入点：

- `packages/server/src/runtime/delivery.ts`
- `packages/server/src/routes/messages.ts`
- `packages/server/src/routes/agents.ts`（DM 投递）
- `packages/server/src/delegation.ts`
- `packages/server/src/taskDelivery.ts`

### 2.3 幂等键（防重复发送）

能力：

- `POST /api/channels/:id/messages` 支持请求头 `x-idempotency-key`
- 同一 `channel + sender + key` 在缓存窗口内重复请求，返回同一条消息（状态码 `200`）

说明：

- 当前实现为服务内存缓存（满足开发/单实例场景）。
- 生产多实例场景建议下一步升级为 DB/Redis 级幂等存储。

### 2.4 流式控制标记兼容（阶段内修复）

修复 `[[CREWDEN_SEND_MESSAGE]]` 标记泄漏到 UI 的问题：

- `packages/paseo-client/src/timeline-to-event-bridge.ts`
- `packages/paseo-client/test/paseo-client.test.ts`

本次进一步增强为“分片流式拼接解析”，避免 `[[CRE` / `WDEN...` 分段输出污染聊天内容。

---

## 三、测试与验证

已执行并通过：

1. `pnpm --filter @crewden/paseo-client typecheck`
2. `pnpm --filter @crewden/paseo-client test`
3. `pnpm --filter @crewden/paseo-client build`
4. `pnpm --filter @crewden/server typecheck`
5. `pnpm --dir /Users/lijun/Documents/crewden/packages/server test -- --bail=1`
6. `pnpm --dir /Users/lijun/Documents/crewden typecheck`

运行态验证：

1. `runtime/status` 为 `connected: true`
2. Claude/Codex 消息链路可用
3. Gemini 不再“在线但不可用”，改为明确错误路径
4. 幂等键重复请求返回相同 message id

---

## 四、与 V2 Phase 3 验收项对齐

### 验收项 A：协作闭环稳定

状态：✅ 完成  
说明：任务/委派/消息投递全部进入统一 runtime delivery seam，并具备失败治理。

### 验收项 B：失败重试、幂等键、死信记录

状态：✅ 完成  
说明：已落地 `deliverWithRetry`、`x-idempotency-key`、`runtime.dead_letter` 审计记录。

### 验收项 C：运行时行为可解释

状态：✅ 完成  
说明：Gemini 在 Paseo 模式下显式拒绝并落盘错误，不再出现“显示在线但无响应”的误导。

---

## 五、变更文件清单（核心）

- `packages/server/src/runtime/runtime-support.ts`（新增）
- `packages/server/src/runtime/delivery-reliability.ts`（新增）
- `packages/server/src/app.ts`
- `packages/server/src/runtime/delivery.ts`
- `packages/server/src/routes/agents.ts`
- `packages/server/src/routes/messages.ts`
- `packages/server/src/delegation.ts`
- `packages/server/src/taskDelivery.ts`
- `packages/server/test/agentsApi.test.ts`
- `packages/paseo-client/src/timeline-to-event-bridge.ts`
- `packages/paseo-client/src/paseo-daemon-client.ts`
- `packages/paseo-client/test/paseo-client.test.ts`

---

## 六、结论

**Phase 3 已完成并通过验证。**  
当前系统已在 Paseo 单 Runtime 基座上具备更稳定的协作闭环，并解决了“Gemini 误在线”“消息投递静默失败”“重复投递”三类核心问题。
