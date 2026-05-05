# Paseo × Crewden Integration 阶段开发总结报告

Date: 2026-05-05  
Scope: Phase4 收尾 + Runtime 可观测性增强 + OpenCode/Pi Provider 集成

## 1. 阶段目标与完成结论

本阶段目标是完成“可运行、可观测、可运维”的集成闭环，并补齐新增 provider 能力。  
结论：核心目标已完成，已进入稳定迭代阶段。

## 2. 本阶段关键交付

### 2.1 Runtime 可观测性与异常处理可视化

已完成：

1. `/api/runtime/status` 扩展并稳定输出：
   - `daemonUrl`
   - `mcpBridgeBin`
   - `mcpBridgeReady`
   - `diagnostics[]`
   - `alerts[]`
   - `agentHealth[]`
2. Web Agent 面板支持异常分层展示：
   - pending requests
   - issue 列表（permission_pending / stream_stalled / state_mismatch / runtime_unreachable）
3. 权限请求可操作化：
   - 单条 `ALLOW / DENY`
   - provider action 回传（selectedActionId）
4. 自动刷新机制补齐：
   - `agent:update` / permission activity 触发刷新
   - 5s polling 兜底

### 2.2 审批体验优化

已完成：

1. `ALLOW ALL` 批量放行当前 pending 请求
2. `AUTO ALLOW SAME` 规则（按 `agentId + kind + name`）
   - 规则本地持久化
   - 后续同类请求自动批准

### 2.3 聊天流稳定性改进

已完成：

1. 流式消息分片合并（避免异常断词/断行）
2. turn 生命周期内同一消息追加写入（append）
3. turn 结束清理 streaming 映射

### 2.4 OpenCode / Pi Provider 集成

按 `opencode-pi-provider-integration.md` 已实现：

1. Runtime 类型扩展：`opencode` / `pi`
2. Shared schema 更新：RuntimeId Zod 校验扩展
3. Runtime 支持策略更新：
   - `isRuntimeSupported` 支持 `claude/codex/opencode/pi`
   - `gemini` 保持 unsupported 提示
4. Paseo runtime mapper 扩展：
   - `opencode -> opencode`
   - `pi -> pi`
5. Web Agent 创建/编辑 runtime 选项扩展
6. 对应单元与 API 测试补齐

### 2.5 MACHINES 侧栏状态语义修复

已完成：

1. 在 `paseo-daemon` 模式下，不再将 `machines=[]` 等价为断连
2. 当 runtime connected 且无 machine 列表时，显示 `Paseo Daemon Connected`
   - 修复“实际连通但 UI 显示 no daemon connected”的假阴性

## 3. 问题复盘与定位结论

### 3.1 Claude “一直 working/没反应”

根因：权限请求 pending，不是纯断流。  
处理：权限可视化 + 操作入口 + 自动刷新已闭环。

### 3.2 OpenCode GLM 启动 error

根因：模型标识不匹配（使用了展示名/拼接名，而非 provider 可识别 model id）。  
日志证据：`Model not found: opencode/GLM-5.1`。  
结论：需使用 provider 返回的真实模型 id。

### 3.3 Machines 显示误报

根因：旧 machine registry 逻辑与新 paseo-daemon 连接语义未对齐。  
处理：已完成 UI 语义修复。

## 4. 验证与测试结果

本阶段执行并通过：

1. `pnpm typecheck`
2. `pnpm --filter @crewden/web typecheck`
3. `pnpm --filter @crewden/web build`
4. `pnpm --filter @crewden/server test -- test/agentsApi.test.ts --bail=1`
5. `pnpm --filter @crewden/shared test -- test/protocol.test.ts --bail=1`
6. `pnpm --filter @crewden/paseo-client test -- test/paseo-client.test.ts --bail=1`

## 5. 本阶段产出文档

已在 `paseo/docs/integration` 下沉淀：

1. `CREWDEN_INTEGRATION_PHASE3_REPORT.md`
2. `CREWDEN_INTEGRATION_PHASE4_REPORT.md`
3. `CREWDEN_INTEGRATION_PHASE4_OBSERVABILITY_APPENDIX.md`
4. `CREWDEN_TURNBASE_ROOT_CAUSE_SOLUTION.md`
5. `opencode-pi-provider-integration.md`
6. `CREWDEN_INTEGRATION_STAGE_SUMMARY_2026-05-05.md`（本报告）

## 6. 阶段结项判断

已满足“阶段开发基本完成”的结项条件：

1. 主链路可运行（Claude/Codex/OpenCode/Pi）
2. 异常可见且可处理（权限/卡住/状态错配）
3. 运维语义清晰（runtime 连接状态与 UI 对齐）
4. 测试与文档均已补齐

后续可转入下一阶段（模型 id 规范化、provider 诊断增强、回归自动化脚本）。
