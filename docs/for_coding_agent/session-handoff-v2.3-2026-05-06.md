# V2.3 Thread Intelligence Handoff

Date: 2026-05-06  
Branch: `feat/slack-like-ai-agent`

## Summary

Implemented v2.3 baseline across shared/server/web:

- Added message intent classification (`chat/task/goal`) at message creation time.
- Added thread intelligence data model via `thread_summaries` (no standalone `threads` table in repo).
- Added thread API routes:
  - `GET /api/threads/:id`
  - `POST /api/threads/:id/resolve`
  - `POST /api/threads/:id/reopen`
  - `GET /api/threads/:id/summary`
- Added automatic thread summary generation:
  - generated when thread message count exceeds 10
  - regenerated on resolve for final snapshot
- Upgraded internal inbox aggregation with project filter + kind filter + mention/review/thread updates.
- Updated web UI:
  - intent badges on messages
  - thread status badge + resolve/reopen controls
  - thread summary block in thread panel
  - added Inbox nav entry with unread-style count and list panel

## Key Files

- Shared:
  - `packages/shared/src/protocol.ts`
  - `packages/shared/src/validation.ts`
- Hub core:
  - `packages/hub-core/src/intentClassifier.ts`
  - `packages/hub-core/src/goalAlignment.ts`
  - `packages/hub-core/src/index.ts`
  - `packages/hub-core/test/intentClassifier.test.ts`
- Server:
  - `packages/server/src/schema.ts`
  - `packages/server/src/db.ts`
  - `packages/server/src/app.ts`
  - `packages/server/src/routes/threads.ts`
  - `packages/server/src/routes/internalAgent.ts`
  - `packages/server/test/threadsApi.test.ts`
  - `packages/server/test/inboxApi.test.ts`
- Web:
  - `packages/web/src/api.ts`
  - `packages/web/src/App.tsx`
  - `packages/web/src/components/ChannelView.tsx`
  - `packages/web/src/components/ThreadPanel.tsx`
  - `packages/web/src/components/Sidebar.tsx`
  - `packages/web/src/components/InboxPanel.tsx`

## Verification Passed

```bash
pnpm --filter @crewden/hub-core test -- intentClassifier.test.ts
pnpm --filter @crewden/server test -- threadsApi.test.ts inboxApi.test.ts
pnpm --filter @crewden/web test
pnpm verify
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
```

## Notes / Caveats

- Internal agent inbox endpoint keeps backward compatibility for old kinds while supporting new kind filters.
- Thread intelligence is implemented through `thread_summaries` because repository does not have a `threads` table.
- Existing `/api/messages/:id/thread` remains available; web now consumes `/api/threads/:id`.
