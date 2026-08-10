# Working agreement

- After completing and testing a requested code change, commit only the files that belong to that request and push the commit to `origin/main`.
- The EasyPanel production service deploys automatically from pushes to `main`; treat a successful push as the deployment trigger and verify production afterward when a safe health/page check is available.
- Never include unrelated pre-existing working-tree changes in the task commit. Never force-push.
- If deployment cannot be completed safely (tests fail, remote diverged, authentication fails, or EasyPanel does not update), stop and report the exact blocker instead of hiding it.
