# OpenCode & Pi Provider 集成可行性报告

> **文档版本:** 1.0
> **创建日期:** 2026-05-04
> **状态:** ✅ 可行 - 已确认 Paseo Daemon 原生支持

---

## 📋 执行摘要

**结论:** 在 Crewden 中添加 `opencode` 和 `pi` 作为新的 agent 模型**完全可行**，且实现成本极低。

**关键发现:**

- Paseo Daemon 已原生支持 `opencode` 和 `pi` provider
- 无需修改 Paseo 项目本身
- Crewden 端仅需修改 4 个文件，约 20 行代码
- 无新增外部依赖

---

## 🔍 Paseo Provider 支持确认

### Paseo 内置 Provider 列表

根据 Paseo 官方文档 (`provider-registry.ts` 和 `Custom Provider Configuration`)：

| Provider ID    | 类型     | 描述                   | 默认命令   | 连接方式                  |
| -------------- | -------- | ---------------------- | ---------- | ------------------------- |
| `claude`       | Built-in | Anthropic Claude Code  | `claude`   | Agent SDK                 |
| `codex`        | Built-in | OpenAI Codex CLI       | `codex`    | AppServer                 |
| `copilot`      | Built-in | GitHub Copilot         | -          | -                         |
| **`opencode`** | Built-in | OpenCode CLI           | `opencode` | HTTP API (managed server) |
| **`pi`**       | Built-in | Minimal terminal agent | `pi`       | Binary                    |
| `acp`          | Special  | Generic ACP            | (需配置)   | -                         |

### Provider 技术细节

#### OpenCode

- **连接方式:** Direct (HTTP API via managed server)
- **会话管理:** Provider-managed
- **特点:**
  - 共享长运行进程
  - 引用计数和端口轮换
  - 多 provider 模型支持
  - 完整的 Zod 事件解析

#### Pi

- **连接方式:** Direct (二进制)
- **会话管理:** Provider-managed
- **特点:** 最小化终端 agent

**验证来源:** https://github.com/getpaseo/paseo

---

## 🏗️ Crewden 架构分析

### 当前架构 (Phase 4)

```
┌─────────────────────────────────────┐
│  Crewden Server                      │
│  ├── Agent Runtime Bridge            │
│  ├── Paseo Runtime Service           │
│  └── Runtime Instance Mapper         │
└──────────────┬───────────────────────┘
               │ Paseo WebSocket 协议
               ▼
┌─────────────────────────────────────┐
│  Paseo Daemon                        │
│  ├── Provider Registry               │
│  ├── claude, codex, opencode, pi...  │
│  └── Agent Lifecycle Management      │
└─────────────────────────────────────┘
```

### 当前支持的 Runtime

**文件:** `packages/shared/src/protocol.ts`

```typescript
export type RuntimeId = "claude" | "codex" | "gemini";
```

**注意:** 虽然 `gemini` 在类型定义中，但根据 `runtime-support.ts`，当前**只支持 `claude` 和 `codex`**：

```typescript
export function isRuntimeSupported(runtime: RuntimeId): boolean {
  return runtime === "claude" || runtime === "codex";
}
```

---

## ✅ 实施方案

### 需要修改的文件

| 文件                                             | 修改类型   | 代码行数估计 |
| ------------------------------------------------ | ---------- | ------------ |
| `packages/shared/src/protocol.ts`                | 类型定义   | +1           |
| `packages/shared/src/validation.ts`              | Zod schema | +1           |
| `packages/server/src/runtime/runtime-support.ts` | 支持检测   | +2           |
| `packages/paseo-client/src/runtime-mapper.ts`    | 映射逻辑   | +4           |
| **总计**                                         |            | **~8 行**    |

### 详细修改内容

#### 1. `packages/shared/src/protocol.ts`

```typescript
// 修改前
export type RuntimeId = "claude" | "codex" | "gemini";

// 修改后
export type RuntimeId = "claude" | "codex" | "gemini" | "opencode" | "pi";
```

#### 2. `packages/shared/src/validation.ts`

```typescript
// 更新 Zod schema (如果存在)
const runtimeIdSchema = z.union([
  z.literal("claude"),
  z.literal("codex"),
  z.literal("gemini"),
  z.literal("opencode"), // 新增
  z.literal("pi"), // 新增
]);
```

#### 3. `packages/server/src/runtime/runtime-support.ts`

```typescript
// 修改前
export function isRuntimeSupported(runtime: RuntimeId): boolean {
  return runtime === "claude" || runtime === "codex";
}

// 修改后
export function isRuntimeSupported(runtime: RuntimeId): boolean {
  return runtime === "claude" || runtime === "codex" || runtime === "opencode" || runtime === "pi";
}

export function unsupportedRuntimeError(runtime: RuntimeId): string {
  if (runtime === "gemini") {
    return `Runtime '${runtime}' is not supported in Paseo mode yet.`;
  }
  return `Runtime '${runtime}' is not supported in Paseo mode. Please use claude, codex, opencode, or pi.`;
}
```

#### 4. `packages/paseo-client/src/runtime-mapper.ts`

```typescript
export function mapRuntimeToProvider(runtime: RuntimeId): string {
  switch (runtime) {
    case "claude":
      return "anthropic";
    case "codex":
      return "openai";
    case "opencode":
      return "opencode"; // 新增
    case "pi":
      return "pi"; // 新增
    case "gemini":
      return "google";
    default:
      return "unknown";
  }
}
```

---

## 🧪 测试计划

### 单元测试

```typescript
// packages/server/test/runtime-support.test.ts

describe("runtime-support", () => {
  it("should support opencode", () => {
    expect(isRuntimeSupported("opencode")).toBe(true);
  });

  it("should support pi", () => {
    expect(isRuntimeSupported("pi")).toBe(true);
  });

  it("should map opencode to opencode provider", () => {
    expect(mapRuntimeToProvider("opencode")).toBe("opencode");
  });

  it("should map pi to pi provider", () => {
    expect(mapRuntimeToProvider("pi")).toBe("pi");
  });
});
```

### 集成测试

1. 创建一个使用 `opencode` runtime 的 agent
2. 验证 agent 能够成功连接到 Paseo Daemon
3. 发送测试消息并验证响应
4. 重复上述步骤测试 `pi` runtime

---

## 📊 风险评估

| 风险                       | 级别  | 缓解措施                              |
| -------------------------- | ----- | ------------------------------------- |
| Paseo Daemon 版本不兼容    | 🟢 低 | opencode/pi 是内置 provider，向后兼容 |
| 用户未安装 opencode/pi CLI | 🟡 中 | 在 UI 中添加安装提示和错误处理        |
| Provider 行为差异          | 🟡 中 | 通过 Paseo 的统一抽象层处理           |
| 测试覆盖不足               | 🟢 低 | 修改量小，易于测试                    |

---

## 🚀 实施步骤

### Phase 1: 代码修改 (30 分钟)

1. 修改上述 4 个文件
2. 运行 TypeScript 类型检查
3. 运行现有测试套件

### Phase 2: 测试 (1 小时)

1. 添加单元测试
2. 手动集成测试
3. 验证 UI 显示

### Phase 3: 文档更新 (15 分钟)

1. 更新 README.md
2. 更新 Agent 创建说明

### Phase 4: 发布 (15 分钟)

1. 创建 Pull Request
2. Code Review
3. 合并到主分支

**总预估时间:** 2 小时

---

## 📝 待确认事项

- [ ] 确认目标 Paseo Daemon 版本 (建议 >= 最新稳定版)
- [ ] 确认测试环境的 opencode/pi CLI 可用性
- [ ] 确认是否需要回退到 gemini 支持

---

## 🎯 成功标准

1. ✅ 用户可以在 UI 中选择 `opencode` 作为 agent runtime
2. ✅ 用户可以在 UI 中选择 `pi` 作为 agent runtime
3. ✅ 使用 opencode/pi 的 agent 能够正常启动和接收消息
4. ✅ 所有现有测试通过
5. ✅ 新增测试覆盖 opencode/pi 相关逻辑

---

## 📚 参考资料

- Paseo GitHub: https://github.com/getpaseo/paseo
- Paseo Provider 文档: `docs/CUSTOM-PROVIDERS.md`
- Paseo Provider Registry: `packages/server/src/server/agent/provider-registry.ts`
- Crewden Paseo 集成进展: `feat/paseo-integration` 分支

---

## 📌 附录

### Paseo Provider 扩展示例

如果未来需要添加自定义 provider，可以在 Paseo 配置中这样定义：

```json
{
  "agents": {
    "providers": {
      "custom-opencode": {
        "extends": "opencode",
        "label": "My OpenCode",
        "command": "/path/to/my/opencode",
        "env": {
          "OPENCODE_API_KEY": "custom-key"
        }
      }
    }
  }
}
```

这展示了 Paseo provider 系统的灵活性和扩展性。

---

**文档结束**
