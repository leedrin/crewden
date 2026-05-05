# V2.0 Polymorphic Actor + Task Contract Handoff

Date: 2026-05-05
Branch: `feat/slack-like-ai-agent`

## What Changed

- Shared protocol now uses the V2 10-state task model:
  `backlog`, `spec_needed`, `ready`, `assigned`, `in_progress`, `in_review`,
  `changes_requested`, `qa`, `done`, `cancelled`.
- `Task` now carries `type`, polymorphic `creator` / `owner` / `reviewer`,
  acceptance fields, dependency fields, blocker metadata, source channel/thread,
  and optimistic `version`.
- `Message` now carries explicit `actorType` and `actorId`.
- Server SQLite schema and Cloudflare Durable Object schema both migrate old
  `todo` tasks to `backlog` and old `blocked` tasks to `in_progress` with
  `isBlocked = true`.
- Server and Cloudflare now enforce the V2 task transition graph and write audit
  entries on task creation/status-change paths.
- Agent-facing task blocker flow is no longer a workflow status. Use
  `isBlocked` / `blockedReason` plus the internal block endpoint/tool.
- Web Task Board now renders a 5-column UI grouping over the 10-state data model:
  Backlog, Todo, In Progress, Review, Done. Each column supports detail-status
  filtering; columns can collapse; mobile defaults to list view; drag/drop maps
  column moves back to concrete task statuses.
- Paseo MCP bridge exposes V2 task status descriptions and adds
  `crewden_block_task`.

## Verification Passed

```bash
pnpm verify
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
```

Notes:

- Cloudflare tests print a Workers Runtime compatibility warning because local
  Miniflare falls back from `2026-04-24` to `2024-12-30`; tests still pass.
- One test dry-run run printed the expected `--dry-run: exiting now` output but
  did not exit when run in parallel with other commands. Re-running the same
  test dry-run alone exited with code 0.

## Follow-Up For V2.1

- Continue from the committed V2.0 baseline.
- Keep blocker handling as metadata rather than reintroducing a `blocked` status.
- For assigned work, use `assigned -> in_progress`; `backlog -> in_progress` is
  intentionally invalid.
- If V2.1 touches Cloudflare or Web deployment surfaces, keep running both
  Worker dry-runs plus the Web build against the test Worker URL.
