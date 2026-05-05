# Paseo × Crewden Integration Phase 2 完成报告

> 日期：2026-05-04  
> 状态：✅ 已完成  
> 对齐文档：`docs/integration/CREWDEN_INTEGRATION_DESIGN_V2.md`

---

## 一、Phase2目标（V2）

Phase2（Week 6-8）核心目标：

1. 强制收敛为单 Runtime（Paseo）
2. 删除 Crewden 旧 daemon 运行时主链路
3. 删除迁移期 `legacy-local` 适配路径
4. 清理服务端旧 runtime 模块与相关测试
5. 保持核心协作流程可回归

---

## 二、交付结论

结论：**Phase2 已完成，Crewden 主运行时已收敛为 Paseo-only。**

主要结果：

1. `packages/daemon/**` 已删除
2. server 侧旧 runtime 模块已删除：
   - `packages/server/src/daemonRegistry.ts`
   - `packages/server/src/ws/daemonSocket.ts`
   - `packages/server/src/runtimeConfig.ts`（已迁移为 `runtime/agent-runtime-config.ts`）
   - `packages/server/src/agentRuntimePatch.ts`（已替换为 `runtime/validate-agent-patch.ts`）
3. `legacy-local` 适配器已删除：
   - `packages/server/src/agent-runtime-bridge/legacy-local-runtime-adapter.ts`
4. `PaseoRuntimeService` 改为固定 `paseo-daemon` 单模式，无 `CREWDEN_DAEMON_MODE`/`legacy-local` 回退逻辑

---

## 三、关键代码变更

核心提交（Crewden仓库）：

- Commit: `055ec06`
- Message: `refactor(runtime): complete Phase2 single-runtime migration to Paseo`
- 规模：53 files changed, 115 insertions(+), 6212 deletions(-)

### 3.1 运行时收敛

1. `packages/server/src/runtime/paseo-runtime-service.ts`
   - 删除 `legacy-local` 分支与兼容开关解析
   - 固定 `configuredMode/effectiveMode = paseo-daemon`
   - 统一通过 `PaseoDaemonMode` 执行 `start/stop/deliver/readWorkspace`
2. `packages/server/src/agent-runtime-bridge/types.ts`
   - `RuntimeMode` 收敛为 `'paseo-daemon'`

### 3.2 服务端旧链路删除

删除：

1. `packages/server/src/ws/daemonSocket.ts`
2. `packages/server/src/daemonRegistry.ts`
3. `packages/server/src/agentRuntimePatch.ts`
4. `packages/server/src/runtimeConfig.ts`
5. `packages/server/src/agent-runtime-bridge/legacy-local-runtime-adapter.ts`
6. `packages/server/test/daemonSocket.test.ts`

替代：

1. `packages/server/src/runtime/agent-runtime-config.ts`
2. `packages/server/src/runtime/validate-agent-patch.ts`

### 3.3 业务入口保持统一

以下入口继续通过 runtime service：

1. `packages/server/src/routes/agents.ts`
2. `packages/server/src/routes/messages.ts`
3. `packages/server/src/delegation.ts`
4. `packages/server/src/taskDelivery.ts`
5. `packages/server/src/routes/internalAgent.ts`

### 3.4 脚本与文档同步

1. 删除 root `package.json` 中 `daemon` script
2. 更新 `start.sh` 为 server+web 启动，并提示配置 `PASEO_DAEMON_URL`
3. 更新 `README.md` 架构与运行说明为 Paseo runtime 模式

---

## 四、测试与验证

执行并通过：

1. `pnpm --dir /Users/lijun/Documents/crewden install`
2. `pnpm --dir /Users/lijun/Documents/crewden --filter @crewden/server typecheck`
3. `pnpm --dir /Users/lijun/Documents/crewden --filter @crewden/web typecheck`
4. `pnpm --dir /Users/lijun/Documents/crewden --filter @crewden/server test -- test/agentsApi.test.ts --bail=1`
5. `pnpm --dir /Users/lijun/Documents/crewden --filter @crewden/server test -- test/tasksApi.test.ts --bail=1`
6. `pnpm --dir /Users/lijun/Documents/crewden --filter @crewden/web test -- test/App.test.tsx --bail=1`
7. `pnpm --dir /Users/lijun/Documents/crewden verify`

结果：

1. 全 workspace `typecheck` 通过
2. 全 workspace `test` 通过
3. server 测试已移除 daemonSocket 依赖并完成 Paseo-only 适配

---

## 五、与V2 Phase2验收标准对齐

### 验收项1：删除 `packages/daemon/**`

状态：✅ 已完成

### 验收项2：删除 server 侧旧 runtime 主链路模块

状态：✅ 已完成  
说明：`daemonRegistry.ts`、`ws/daemonSocket.ts`、`runtimeConfig.ts`、`agentRuntimePatch.ts` 已删除/迁移

### 验收项3：删除 `legacy-local` 适配器与开关路径

状态：✅ 已完成  
说明：`legacy-local` 适配器文件删除，runtime mode 固定为 `paseo-daemon`

### 验收项4：代码库不再以旧 runtime 作为主链路

状态：✅ 已完成  
说明：业务主入口全部由 `PaseoRuntimeService` 驱动

---

## 六、Phase3启动建议

1. 完成 22 工具协作闭环的扩展开发
2. 完善 Paseo 模式下 workspace 读取与恢复链路
3. 增加失败重试、幂等键、死信记录等生产化机制

---

## 七、结论

**Phase2 已按计划完成，Paseo 作为唯一 runtime 基座已落地，可进入 Phase3。**
