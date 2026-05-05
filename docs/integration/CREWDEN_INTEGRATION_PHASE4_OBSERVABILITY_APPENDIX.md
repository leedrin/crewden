# Paseo × Crewden Integration Phase 4 Observability Appendix

Date: 2026-05-04  
Related Phase: Phase 4（Productionization & Operations Hardening）

## 1. Purpose

This appendix consolidates:

1. Phase 4 completed items（already delivered）
2. Additional exception-handling visualization maintenance delivered after Phase 4 regression checks

Goal: make runtime blocking reasons visible and operable in Web UI, without relying on manual CLI diagnosis.

## 2. Phase 4 Completed Baseline (Recap)

Based on `CREWDEN_INTEGRATION_PHASE4_REPORT.md`, completed baseline includes:

1. Runtime diagnostics endpoint expansion (`/api/runtime/status`)
2. Web diagnostics panel rendering for daemon/MCP readiness
3. Start/Stop + AutoStart controls in agent profile panel
4. Paseo-runtime unification consistency (runtime mode centered on `paseo-daemon`)

## 3. Added Exception-Handling Visualization Maintenance

### 3.1 Runtime health and blocking signals surfaced end-to-end

`/api/runtime/status` now carries operationally actionable health fields:

1. `alerts[]` (e.g. `permission_pending:*`, `stream_stalled:*`, `state_mismatch:*`)
2. `agentHealth[]` including:
   - runtime lifecycle
   - pending permission requests
   - issue list
   - last activity timestamp

This allows UI to distinguish “agent still running” vs “agent blocked by permission” vs “stream stalled”.

### 3.2 Permission / question-like requests are visible and actionable in Web

Agent panel now renders pending request cards with:

1. request kind (`tool/plan/question/mode/other`)
2. name/title/description
3. request id snippet
4. action buttons from provider-defined `actions[]` when available
5. fallback `ALLOW` / `DENY` actions when no provider actions are present

Also added backend permission response API for Web:

- `POST /api/runtime/agents/:agentId/permissions/:permissionId/respond`

### 3.3 Auto-refresh to remove manual refresh dependency

To prevent stale permission visibility:

1. refresh runtime status on `agent:update` event
2. refresh runtime status when activity detail indicates permission request/resolution
3. add 5s polling fallback for runtime status

Result: new requests generally appear without manual browser refresh.

### 3.4 Approval ergonomics enhancements

To reduce repetitive clicking:

1. `ALLOW ALL` per agent for current pending batch
2. `AUTO ALLOW SAME` rule toggle:
   - scope: `agentId + permission.kind + permission.name`
   - persisted in browser local storage
   - auto-applies allow for matched future requests

## 4. Root-Cause Behavior Clarification

Observed behavior in field tests:

1. user allows one request
2. agent proceeds and triggers another tool request
3. UI appears “still stuck” if next request is not surfaced immediately

This is not a single failed allow; it is a sequence of newly generated approvals.  
The added auto-refresh + batch/auto-allow controls directly target this behavior.

## 5. Validation Snapshot

Executed on 2026-05-04:

1. `pnpm typecheck` ✅
2. `pnpm --filter @crewden/web build` ✅
3. `pnpm --filter @crewden/server test -- test/agentsApi.test.ts --bail=1` ✅

## 6. Remaining Recommendation

For high-trust environments, consider optional UI switch to set agent mode to Paseo `bypassPermissions` (with explicit warning), as a stronger alternative to per-request approval.
