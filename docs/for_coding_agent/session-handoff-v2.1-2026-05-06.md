# V2.1 Agent Identity Handoff

Date: 2026-05-06  
Branch: `feat/slack-like-ai-agent`

## Summary

Implemented v2.1 baseline for Agent Identity:

- Added agent identity fields: `role`, `responsibilities`, `capabilities`, `workingStyle`, `handoffPreference`, `constraints`, `examples`.
- Added per-agent `agent_permissions` model and persistence.
- Added permission enforcement for agent-authenticated API calls.
- Added profile-based resolver (`role/capabilities/load`) in `hub-core`.
- Added API filters and resolver endpoints.
- Added Web Agent profile editing controls for role/capabilities/profile text + permissions JSON.
- Added MCP bridge tools:
  - `crewden_agent_profile`
  - `crewden_resolve_agents`

## Key Files

- Shared:
  - `packages/shared/src/protocol.ts`
  - `packages/shared/src/validation.ts`
- Hub-core:
  - `packages/hub-core/src/agentResolver.ts`
  - `packages/hub-core/src/index.ts`
- Server:
  - `packages/server/src/schema.ts`
  - `packages/server/src/db.ts`
  - `packages/server/src/agentPermissions.ts`
  - `packages/server/src/requestAgentAuth.ts`
  - `packages/server/src/routes/agents.ts`
  - `packages/server/src/routes/internalAgent.ts`
  - `packages/server/src/routes/tasks.ts`
  - `packages/server/src/routes/messages.ts`
  - `packages/server/src/routes/knowledge.ts`
- Web:
  - `packages/web/src/api.ts`
  - `packages/web/src/components/AgentDetailPanel.tsx`
- Paseo client MCP bridge:
  - `packages/paseo-client/src/mcp-bridge/tools.ts`

## Verification

Passed:

```bash
pnpm verify
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
```

## Notes

- Existing user-edited `docs/slack/*` files were intentionally left untouched in this commit.
- Public API permission checks are active when `x-agent-id` + valid agent bearer token are present; normal browser requests without agent headers continue to work.
