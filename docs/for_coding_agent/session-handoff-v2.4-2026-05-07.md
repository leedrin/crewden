# Session Handoff: v2.4 Context Package Engine

**Date**: 2026-05-07
**Branch**: `feat/slack-like-ai-agent` (merged from `feat/v2.4-context-package`)
**Version spec**: `docs/slack/v2.4-context-package.md`

## Summary

Implemented v2.4 Context Package Engine. When a Task transitions to `assigned`, the system auto-generates a prioritized context package from multiple data sources (task definition, constraints, decisions, documents, thread summaries, parent task results), truncated to the agent's `maxContextTokens` budget.

## Completed Tasks

### Task 1: Context Package Builder (hub-core)
- `packages/hub-core/src/contextPackageBuilder.ts` — `estimateTokens()` and `buildContextPackage()`
- 5 priority levels: task (1) → constraints (2) → decisions/documents (3) → thread summary (4) → parent results (5)
- Token budget truncation with partial section support
- 14 tests in `packages/hub-core/test/contextPackageBuilder.test.ts`

### Task 2: Server Trigger
- `packages/server/src/routes/tasks.ts` — auto-generates on POST create + PATCH status→assigned
- `POST /api/tasks/:id/context-package` endpoint for regeneration
- Returns fresh task from DB after context package update (avoids version conflicts)
- 4 tests in `packages/server/test/contextPackageApi.test.ts`

### Task 3: Token Estimation (integrated into Task 1)
- `estimateTokens()` handles English (4 chars/token), CJK (2 chars/token), mixed content

### Task 4: Cloudflare Parity
- `packages/cloudflare/src/index.ts` — mirrors server behavior
- `regenerateContextPackage()` and `generateAndStoreContextPackage()` methods
- Data sources: sync wrappers around DO's SQLite methods
- No `getThreadSummary` or `getAgentPermissions` in CF — returns undefined (defaults work)

### Task 5: Web UI Preview
- `packages/web/src/components/TaskBoard.tsx` — `ContextPackagePreview` component
- Collapsible section showing sections with token estimates, total budget usage
- Regenerate button calling `regenerateContextPackage()` API
- `packages/web/src/api.ts` — added types (`ContextPackage`, `ContextSection`, `ContextSectionSource`) and `regenerateContextPackage()` function

## Verification

- `pnpm verify` — all typecheck + tests pass (166 tests total)
- Cloudflare `wrangler deploy --dry-run` — passes for both prod and test configs
- Web build — passes with test API base

## Key Design Decisions

1. **Version conflict avoidance**: `generateAndStoreContextPackage` does a separate `store.updateTask` which bumps the version. To avoid version conflicts for callers, the PATCH/POST handlers re-fetch the task from DB after context package generation.

2. **Cloudflare async mismatch**: CF data sources are sync (SQLite in DO), but `buildContextPackage` expects async callbacks. Wrapped in async lambdas. `createUserTask` and `patchTask` became async.

3. **ContextPackage on TaskContext**: The `contextPackage` field lives inside `task.context` rather than at task top-level, keeping it part of the existing JSON blob.

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/protocol.ts` | Added `ContextSectionSource`, `ContextSection`, `ContextPackage` types; `contextPackage` on `TaskContext` |
| `packages/shared/src/validation.ts` | Added `ContextSectionSchema`, `ContextPackageSchema` |
| `packages/hub-core/src/contextPackageBuilder.ts` | **New**: Core builder engine |
| `packages/hub-core/src/index.ts` | Added export |
| `packages/hub-core/test/contextPackageBuilder.test.ts` | **New**: 14 tests |
| `packages/server/src/routes/tasks.ts` | Added generation triggers + regeneration endpoint |
| `packages/server/test/contextPackageApi.test.ts` | **New**: 4 tests |
| `packages/cloudflare/src/index.ts` | Added parity methods + route |
| `packages/web/src/api.ts` | Added types + `regenerateContextPackage` |
| `packages/web/src/components/TaskBoard.tsx` | Added `ContextPackagePreview` component |

## Known Caveats

- Cloudflare has no `getThreadSummary` or `getAgentPermissions` — context packages on CF won't include thread summary sections and default to 100k token budget
- The version bump from context package storage means rapid sequential PATCHes on the same task need to account for the version change
- `estimateTokens` is a rough heuristic, not an exact tokenizer
