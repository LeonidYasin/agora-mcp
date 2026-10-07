# Contributing

## Issue → branch → PR → checks → merge

Every change starts with an issue describing the problem, scope, acceptance criteria and how it will be tested. Reuse a matching issue instead of duplicating it. Keep PRs focused.

Create a branch from the latest `main`, named like `feat/12-match-cards`, `fix/13-embedding-timeout` or `chore/1-repository-workflow`. Do not push directly to `main`.

Open a PR against `main` and link its issue (`Closes #N` only if it completes the whole issue; otherwise `Refs #N`). Explain changes, testing and compatibility/operational impact. CI must pass and review conversations must be resolved before the maintainer merges. Prefer squash merge. Agents must not merge or deploy without an explicit request.

## Local checks

Use Node.js 22 and npm:

```bash
cd mcp-server
npm ci
npm run build
```

Smoke tests need PostgreSQL 16 with pgvector and a disposable database whose name ends in `_test`. Apply both migrations with `psql -v ON_ERROR_STOP=1`, then run `bash e2e/run.sh`. See [the E2E guide](mcp-server/e2e/README.md). The test truncates tables; never use production data. Fake embeddings verify integration and isolation, not semantic quality.

Commit `package-lock.json` whenever dependencies change. Never commit secrets. CI has no production credentials and does not deploy.

## Enable real protection for the default branch

This file does **not** protect GitHub branches. A repository administrator must activate the following policy in GitHub Settings → Branches (classic protection), or an equivalent active ruleset targeting the default branch:

- Require a pull request before merging.
- Require successful status checks: `Build` and `Smoke test` from the `CI` workflow. Run the first PR workflow so GitHub can discover these checks.
- Require the branch to be up to date before merging.
- Require review conversations to be resolved.
- Do not allow bypassing the settings (including administrators); for a ruleset, keep the bypass list empty.
- Do not allow force pushes or branch deletion.

For a solo maintainer, leave required approving reviews at **zero**: GitHub does not allow authors to approve their own PRs. The maintainer still reviews the diff and CI before merging. When a second reviewer is available, require one approval and dismiss stale approvals.

Protection applies to every actor, including automation and agents. Do not add bypass privileges for convenience. Document any intentional policy change in an issue. Verify enforcement in GitHub, not just this document.
