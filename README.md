# Crewden

A minimal self-hosted agent workspace: web chat + server + Paseo runtime-backed agents.

## Architecture

```
Browser (React/Vite)
    |  HTTP REST + WebSocket (/ws)
    v
Server (Fastify + Node.js)  <-- in-memory store
    |  Paseo WebSocket protocol
    v
Paseo Daemon
    |  provider runtimes
    v
CLI Agents: claude | codex | ...
```

The server owns collaboration state (channels/messages/tasks/goals/reviews/knowledge), while Paseo provides agent runtime lifecycle and stream events.

## Install

```bash
pnpm install
```

## Running

### Start server + web UI

```bash
pnpm dev
```

- Server: http://localhost:3000
- Web UI: http://localhost:5173

### Windows one-command startup

From PowerShell in repo root:

```powershell
pnpm run start:windows
```

For first-time setup/build on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1 -Build
```

Useful options:

- `-Mode prod|dev` (default: `prod`)
- `-DaemonUrl ws://127.0.0.1:6767/ws`
- `-McpBridgeBin C:\path\to\crewden\packages\paseo-client\dist\mcp-bridge\index.js`
- `-SkipDaemonCheck`

### Configure Paseo runtime

```bash
export PASEO_DAEMON_URL=ws://127.0.0.1:6767/ws
export PASEO_DAEMON_API_KEY=<optional-token>
```

### Cloudflare central hub

To run Crewden with a public centralized server, deploy `packages/cloudflare`:

```bash
pnpm --filter @crewden/cloudflare exec wrangler login
pnpm --filter @crewden/cloudflare run deploy
```

Set the daemon and browser auth secrets on the Worker once:

```bash
printf '%s' '<daemon-key>' | pnpm --filter @crewden/cloudflare exec wrangler secret put DAEMON_API_KEY
printf '%s' '<web-token>'  | pnpm --filter @crewden/cloudflare exec wrangler secret put WEB_AUTH_TOKEN
```

Then point the web UI at the Worker URL:

```bash
VITE_API_BASE=https://crewden-hub.<account>.workers.dev \
VITE_WEB_AUTH_TOKEN=<web-token> \
pnpm --filter @crewden/web dev
```

#### CI/CD (recommended)

Push to `main` automatically deploys via GitHub Actions. Required secrets in repo Settings:

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Wrangler auth |
| `CLOUDFLARE_ACCOUNT_ID` | Your account |
| `DAEMON_API_KEY` | Worker secret for daemon connections |
| `WEB_AUTH_TOKEN` | Worker secret for browser/REST auth (optional but required for public hub) |

To trigger manually:

```bash
gh workflow run deploy-cloudflare-hub.yml
gh workflow run deploy-cloudflare-pages.yml
```

See `docs/cloudflare-central-hub.md` for the full workflow and production notes.

## Versioning

All components expose or carry a version:

- Web: build-time `VITE_APP_VERSION`, shown in the sidebar.
- Server and Cloudflare hub: `GET /api/version`.

Local defaults use the package version. CI/CD injects the Git commit SHA into `CREWDEN_VERSION` and `VITE_APP_VERSION` so every deployed iteration is identifiable.

## Verify (typecheck + tests)

```bash
pnpm verify
```

## Creating your first agent

1. Open http://localhost:5173
2. Ensure `PASEO_DAEMON_URL` points to a reachable Paseo daemon
3. Click **+ New** in the Agents panel
4. Fill in name and runtime (claude/codex)
5. Click **Create Agent**, then **Start**
6. In the composer, select the agent from the dropdown and send a message

## Runtime Prerequisites

- **Claude**: `claude --version` must work. Install via `npm install -g @anthropic-ai/claude-code` and authenticate.
- **Codex**: `codex --version` must work. Install via `npm install -g @openai/codex` and set `OPENAI_API_KEY`.
Gemini support depends on Paseo provider availability.

## Known Limitations

- **In-memory store**: all data is lost on server restart. SQLite persistence is a planned improvement.
- **Paseo dependency**: Crewden runtime depends on an available Paseo daemon.
- **No file browser, billing, or enterprise permissions**.

## Package Structure

```
packages/
  shared/     - Protocol types and Zod validators
  server/     - Fastify HTTP + WebSocket server
  paseo-client/ - Paseo daemon client + bridge helpers
  web/        - React + Vite frontend
```
