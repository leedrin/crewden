# V2.2.1 Project Isolation Handoff

Date: 2026-05-06  
Branch: `feat/slack-like-ai-agent`

## Summary

Implemented V2.2.1 baseline for multi-project isolation:

- Added `Project` model and `/api/projects` CRUD (delete guarded for non-empty projects).
- Added `project_id` migration + defaults for server SQLite core tables:
  `channels/messages/tasks/agents/goals/goal_alignments/reminders/knowledge_entries/decisions/documents/audit_log`.
- Added default project bootstrap (`default`) and made `general` channel belong to it.
- Added project filtering support in server routes:
  `channels/tasks/agents/goals/goal-alignments/knowledge/decisions/documents/search`.
- Added `/api/audit` endpoint with `projectId` filtering.
- Updated web app with Project Switcher and project-scoped loading:
  channels/agents/tasks/knowledge/search bound to current project.
- Added URL project slug sync (`/{projectSlug}` via `history.replaceState`).
- Added project-aware task/agent/knowledge creation flows in UI.

## Key Files

- Shared:
  - `packages/shared/src/protocol.ts`
  - `packages/shared/src/validation.ts`
- Server:
  - `packages/server/src/schema.ts`
  - `packages/server/src/db.ts`
  - `packages/server/src/app.ts`
  - `packages/server/src/routes/projects.ts`
  - `packages/server/src/routes/audit.ts`
  - `packages/server/src/routes/channels.ts`
  - `packages/server/src/routes/tasks.ts`
  - `packages/server/src/routes/agents.ts`
  - `packages/server/src/routes/goals.ts`
  - `packages/server/src/routes/goalAlignments.ts`
  - `packages/server/src/routes/knowledge.ts`
  - `packages/server/src/routes/decisions.ts`
  - `packages/server/src/routes/documents.ts`
  - `packages/server/src/routes/messages.ts`
  - `packages/server/test/projectsApi.test.ts`
- Web:
  - `packages/web/src/api.ts`
  - `packages/web/src/App.tsx`
  - `packages/web/src/components/Sidebar.tsx`
  - `packages/web/src/components/TaskBoard.tsx`
  - `packages/web/src/components/AgentPanel.tsx`
  - `packages/web/src/components/KnowledgePanel.tsx`
  - `packages/web/test/App.test.tsx`

## Verification Passed

```bash
pnpm verify
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
```

## Notes

- `docs/slack/*` user-authored planning docs were intentionally not included in code commit scope.
- Cloudflare worker parity for `project_id` data model is not yet fully mirrored in dedicated worker routes; current V2.2.1 implementation is fully landed in server + web path.
