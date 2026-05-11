# Agent Development Rules

These rules are mandatory for coding agents working in this repository.

## Project Boundary

`crewden` is an external open source project hosted on GitHub. Keep it separate
from internal company projects, including sibling workspaces such as
`sailor_agent_workspace`.

- Do not copy private company code, internal architecture details, credentials,
  private endpoints, customer data, or other non-public information into this
  repository.
- Do not commit internal deployment details, internal URLs, company-specific
  business context, or internal handoff notes here unless the user explicitly
  confirms the information is safe for the open source project.
- When a task touches both this repository and an internal project, keep commits,
  documentation, knowledge entries, and verification evidence separated by
  project.

## First Read

Before making non-trivial changes, read the current coding-agent handoff notes:

```text
docs/for_coding_agent/
```

Treat these notes as project memory for recent operational context, current deployment habits, and product lessons. If a turn produces durable knowledge that future coding agents need, add or update a document in this directory.

## Product Direction

The project goal is to build an agent-first company organization.

- The user is the boss: they give goals, priorities, and approvals.
- Agents should coordinate like a company: clarify intent, split work, claim ownership, pass context, request review, produce evidence, and close the loop.
- Favor changes that reduce user micromanagement, improve agent-to-agent context transfer, make progress visible, and preserve useful knowledge.
- Do not optimize only for chat replies. Important work should update system state: tasks, goals, reviews, messages, and knowledge.

## Branch Workflow

**Never implement changes directly on `main`.** No exceptions.

`main` is a protected branch. All development happens on feature branches
(merged into `feat/slack-like-ai-agent` or directly into `main` via `--no-ff`).
If you find yourself on `main` with uncommitted changes, stop immediately,
stash or reset, and switch to a proper feature branch before continuing.

For every development task:

1. Start from a clean working tree on `feat/slack-like-ai-agent` (or `main`).
2. Pull or fetch the latest remote state when network access is available.
3. Create a new task branch before editing files.
5. Make all code, test, and documentation changes on that branch.
6. Run the required verification commands.
7. Commit on the task branch.
8. Push the task branch to GitHub so the development process is preserved remotely.
9. Merge back to `main` only after verification passes.
10. Push `main`.
11. Let the Cloudflare test environment deploy and verify it when the change is deployable.
12. Deploy production only after the user explicitly approves promotion.

Use concise branch names:

```bash
git switch main
git switch -c <type>/<short-task-name>
```

Examples:

```bash
git switch -c feat/cloudflare-auth
git switch -c fix/agent-start-rebind
git switch -c docs/cloudflare-runbook
git switch -c refactor/hub-core
```

## Verification Gate

Before merging to `main`, run:

```bash
pnpm verify
```

If the change touches Cloudflare Worker code, also run:

```bash
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

If the change touches Cloudflare Pages deployment, also run:

```bash
VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
```

If a test or command fails, fix it on the task branch and rerun the failing command. Do not merge a failing branch.

## Version Propagation

Every deployable iteration must carry a version across components.

- Keep the default source version in `packages/shared/src/version.ts` aligned with the project version when doing a named release.
- CI/CD should inject the current commit SHA through `CREWDEN_VERSION` for hub/server/daemon-style runtimes and `VITE_APP_VERSION` for the web build.
- Do not hardcode a new component-local version if it can use the shared version helper or the build-time environment variable.

## Knowledge And Handoff Discipline

Every substantial development session should leave usable context for the next coding agent.

Use these locations consistently:

- Long-term rules and mandatory workflow constraints belong in `AGENTS.md`.
- Cross-session handoff summaries, runbooks, and reusable operational lessons belong in `docs/for_coding_agent/`.
- Product/version execution plans belong in `docs/v*.md`.
- Agent-local working context belongs in agent workspace `MEMORY.md` and `notes/`.
- Project-level reusable decisions, runbooks, lessons, user preferences, and archives should also be written through the Knowledge layer when available.

When exporting session knowledge:

1. Summarize the current repository state and recent commits.
2. Record changed components and key files.
3. Record verification commands that passed or failed.
4. Record common tool commands and invocation patterns.
5. Record project-specific lessons and business/domain knowledge.
6. Record known pitfalls and caveats.
7. Prefer concise structured summaries over raw chat logs.

Never write secrets, auth tokens, API keys, or sensitive private data into `AGENTS.md`, docs, `MEMORY.md`, notes, transcripts, or Knowledge entries.

## Merge Procedure

After verification passes:

```bash
git status --short
git add -A
git commit -m "<type>(scope): <summary>"
git push -u origin <task-branch>
git switch main
git merge --no-ff <task-branch>
git push origin main
```

If the task branch already has an upstream, use `git push origin <task-branch>` after the commit. Do not delete the remote task branch unless the user explicitly asks; it is part of the development record.

Do not use `git reset --hard`, `git checkout --`, or destructive cleanup unless the user explicitly asks.

## Cloudflare Environment Gate

Cloudflare test is the default remote deployment target for deployable work.

- Test Worker: `crewden-hub-test`
- Test Worker URL: `https://crewden-hub-test.xingke0.workers.dev`
- Test Pages project: `crewden-web-test`
- Production Worker: `crewden-hub`
- Production Worker URL: `https://crewden-hub.xingke0.workers.dev`
- Production Pages project: `crewden-web`

Production is the current live environment. Do not trigger production workflows, run `deploy:prod`, or deploy the `crewden-web` Pages project unless the user has explicitly approved promotion after test validation.

Expected flow:

1. Merge verified work to `main`.
2. Confirm the `Deploy Cloudflare Test` workflow succeeds.
3. Validate the user-facing behavior on the test Pages URL.
4. Ask for production approval with the test result summary.
5. Only after approval, manually run the production Hub and Pages workflows.

## Agent Experience Rules

- When an agent claims or starts long-running work, the user should see a fast acknowledgement in the relevant channel or thread before the slow work continues.
- Task handoffs must carry enough context for the next agent: objective, background, constraints, acceptance criteria, dependencies, artifacts, and private notes when appropriate.
- Agent display names are not stable identifiers. Prefer agent id first, then unique name/display name when resolving a target.
- Do not mark meaningful work `done` without concrete evidence. High-risk work should be reviewed by a different agent unless the user explicitly allows self-review with a reason.
- Before context-dependent work, search project knowledge. Write durable decisions, user preferences, runbooks, failure lessons, and reusable facts back to knowledge. Do not store secrets or short-lived chat noise.

## When Already On A Feature Branch

If the agent starts on a non-main branch:

- Continue on that branch if it clearly matches the user's task.
- Otherwise ask before switching branches if there are uncommitted changes.
- Never discard existing user changes.

## Emergency Exception

Direct edits on `main` are allowed only when the user explicitly requests a hotfix on `main`. In that case, state the exception in the final response.
