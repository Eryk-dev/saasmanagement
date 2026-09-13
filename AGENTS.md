# Working agreement

- After completing and testing a requested code change, commit only the files that belong to that request and push the commit to `origin/main`.
- The EasyPanel production service deploys automatically from pushes to `main`; treat a successful push as the deployment trigger and verify production afterward when a safe health/page check is available.
- Never include unrelated pre-existing working-tree changes in the task commit. Never force-push.
- If deployment cannot be completed safely (tests fail, remote diverged, authentication fails, or EasyPanel does not update), stop and report the exact blocker instead of hiding it.

# Project context

- Start with [docs/CONTEXTO-COCKPIT.md](docs/CONTEXTO-COCKPIT.md), the project map checked against the current code. Read the linked domain references only when relevant to the task.
- `docs/PLANO-REWORK.md`, `README.md`, and `PORTFOLIO.md` contain historical decisions and outdated implementation notes. Verify current behavior in code and tests before treating an old pending item as new work.
- Communicate with the user in Brazilian Portuguese. Keep changes focused on the requested outcome.
- Preserve concurrent work: inspect the working tree before editing and again before staging. Stage explicit task paths; do not reset, stash, or commit another task's edits.

# Implementation and validation

- REST is the source of truth. The SPA and the project's MCP server use that API; Postgres access belongs in `packages/api/src/db.js`.
- Preserve product scoping through `saas` and the global workspace in `packages/web/src/lib/workspace.js`.
- Preserve financial definitions, stage semantics, and backend authorization described in the context guide. Reuse the domain helpers and their existing tests.
- Before starting the API, verify that `COCKPIT_DB_URL` targets an isolated development database. Startup runs data migrations and background integrations; historical local configurations used production's database. Never print credentials while checking configuration.
- Use the existing in-memory API tests and web smoke test for local verification. Do not start the production-connected API merely to check a build.
- For UI work, consult the existing `.claude/skills/cockpit-ui-review/SKILL.md` and its design references. Follow the user's authorized scope; a request to implement a fix does not require a second approval just because the generic review workflow separates findings from edits.
- Keep the context guide current when a task changes architecture, an invariant, validation commands, or deployment behavior. A new external extension is warranted only when the task needs a capability the available tools do not provide.
