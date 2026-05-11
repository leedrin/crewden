# Session Handoff: v2.4.1 Code Hardening & Context Freshness

**Date**: 2026-05-07
**Branch**: `refactor/v2.4.1-code-hardening` (from `feat/slack-like-ai-agent`)
**Version spec**: `docs/slack/v2.4.1-code-hardening.md`

## Summary

v2.4.1 is a pure code-health iteration with zero new features. It addresses two P0 issues found in the v2.4 architecture review:

1. **Repository extraction from `server/db.ts`** — extracted Task, Channel, Message, Thread, Project, and ContextPackageRef into individual repository classes under `packages/server/src/repository/`
2. **ContextPackage staleness detection** — documents/decisions updates now mark related task context packages as stale; agent pull auto-regenerates when stale

## Completed Tasks

### Task 1: Repository Extraction (server)
- `packages/server/src/repository/types.ts` — `TaskRepository`, `ChannelRepository`, `MessageRepository`, `ThreadRepository`, `ProjectRepository`, `ContextPackageRefRepository` interfaces + `NewTask`/`TaskPatch`/`NewMessage` types
- `packages/server/src/repository/task.repository.ts` — `SqliteTaskRepository` extracted from `db.ts`, handles all task CRUD, status normalization (`todo→backlog`, `blocked→in_progress`), JSON array parsing, column-to-Task mapping
- `packages/server/src/repository/channel.repository.ts` — `SqliteChannelRepository`
- `packages/server/src/repository/message.repository.ts` — `SqliteMessageRepository`
- `packages/server/src/repository/thread.repository.ts` — `SqliteThreadRepository` with `ThreadSummaryRow` type
- `packages/server/src/repository/project.repository.ts` — `SqliteProjectRepository`
- `packages/server/src/repository/contextPackageRef.repository.ts` — `SqliteContextPackageRefRepository` for staleness tracking
- `packages/server/src/repository/index.ts` — barrel export
- `packages/server/src/db.ts` reduced from ~2200 to ~1800 lines; routes now call repository methods instead of raw db queries

### Task 2: hub-core Task State Machine
- `packages/hub-core/src/taskStateMachine.ts` — extracted V2 10-state transition validation from `db.ts`, eliminating server/cloudflare duplicate logic
- `packages/hub-core/test/taskStateMachine.test.ts` — 170 lines of tests covering valid/invalid transitions
- `packages/hub-core/src/index.ts` — added `taskStateMachine` export

### Task 3: ContextPackage Staleness
- `packages/shared/src/protocol.ts` — added `stale`, `staleReason`, `dataSourcesUpdatedAt` to `ContextPackage`
- `packages/shared/src/validation.ts` — `ContextPackageSchema` extended
- `packages/shared/test/protocol.test.ts` — added staleness validation tests
- `packages/server/src/routes/decisions.ts` — decision update marks related task context packages stale
- `packages/server/src/routes/documents.ts` — document update marks related task context packages stale
- `packages/server/src/routes/tasks.ts` — task GET auto-regenerates context package when stale
- `packages/cloudflare/src/index.ts` — Cloudflare parity: staleness marking on decision/document updates, auto-regenerate on task fetch

## Key Design Decisions

1. **Repository pattern without full abstraction** — Repositories are concrete classes (`SqliteTaskRepository`) not interfaces, matching the "don't over-engineer" principle. Routes import the concrete class directly. Full `IRepository` interfaces deferred to when cloudflare needs a shared contract.

2. **Staleness via data source timestamps** — Rather than a simple boolean flag, `dataSourcesUpdatedAt` tracks each source's last update time. When an agent pulls a task, the system compares context package `generatedAt` against each data source timestamp to detect staleness.

3. **Auto-regeneration on access** — When a context package is detected as stale during task fetch, the system auto-regenerates it synchronously before returning the task. This ensures agents always receive fresh context without explicit "refresh" calls.

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/protocol.ts` | Added stale fields to ContextPackage |
| `packages/shared/src/validation.ts` | Extended ContextPackageSchema |
| `packages/shared/test/protocol.test.ts` | Added staleness validation tests |
| `packages/hub-core/src/taskStateMachine.ts` | **New**: Extracted task transition validation |
| `packages/hub-core/src/index.ts` | Added taskStateMachine export |
| `packages/hub-core/test/taskStateMachine.test.ts` | **New**: 170 lines of state machine tests |
| `packages/server/src/repository/types.ts` | **New**: Repository interfaces + types |
| `packages/server/src/repository/task.repository.ts` | **New**: SqliteTaskRepository |
| `packages/server/src/repository/channel.repository.ts` | **New**: SqliteChannelRepository |
| `packages/server/src/repository/message.repository.ts` | **New**: SqliteMessageRepository |
| `packages/server/src/repository/thread.repository.ts` | **New**: SqliteThreadRepository |
| `packages/server/src/repository/project.repository.ts` | **New**: SqliteProjectRepository |
| `packages/server/src/repository/contextPackageRef.repository.ts` | **New**: ContextPackageRefRepository |
| `packages/server/src/repository/index.ts` | **New**: Barrel export |
| `packages/server/src/db.ts` | Refactored to use repositories; ~2200→~1800 lines |
| `packages/server/src/routes/tasks.ts` | Stale detection + auto-regenerate |
| `packages/server/src/routes/decisions.ts` | Staleness marking on update |
| `packages/server/src/routes/documents.ts` | Staleness marking on update |
| `packages/cloudflare/src/index.ts` | Cloudflare parity for staleness |

## Verification

```bash
pnpm verify   # all typecheck + tests pass
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
```

## Known Caveats

- Repository extraction only covers server side; Cloudflare data access in `index.ts` (~4470 lines) still needs similar extraction (deferred to v2.5, P1 item)
- hub-core still thin — full business logic extraction deferred to v2.5 P1 items
- Web type isolation from `@crewden/shared` still unresolved (v2.5 P1)
- `db.ts` at ~1800 lines is still large — further extraction of agent/runtime/reminder repositories deferred
