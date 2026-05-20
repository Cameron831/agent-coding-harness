# Implement Prompt

You are the implementor agent for GitHub issue #121.

## Issue Context

---

Title:
Make worktree cleanup idempotent when the worktree is already absent

Body:
## Goal

Update the local Git cleanup operation so rerunning cleanup after a worktree has already been removed succeeds as a no-op instead of failing validation.

## Scope

- Update `LocalGitAutomationClient.cleanupWorktree` to treat a target path missing from `git worktree list --porcelain` as an already-cleaned-up state.
- Return the existing cleanup result shape with `removed: false` for the already-absent no-op path.
- Ensure the no-op path happens only after input validation and a successful worktree list command.
- Skip `git status --porcelain`, `git clean -fdX`, and `git worktree remove` when the worktree is already absent.
- Preserve existing behavior for associated clean worktrees, dirty non-force worktrees, forced cleanup, list failures, status failures, clean failures, and remove failures.
- Update focused local Git client tests for the absent-worktree no-op result and command sequence.
- Adjust release cleanup retry tests only if existing expectations need to treat `removed: false` as successful cleanup.

## Acceptance Criteria

- `cleanupWorktree` returns `ok: true` with `removed: false` when the target worktree path is not present in `git worktree list --porcelain` output.
- The already-absent cleanup path runs no Git commands after `worktree list --porcelain`.
- A clean associated worktree still runs status, ignored-file clean, and worktree removal in the existing order and returns `removed: true`.
- Dirty associated worktrees still fail without `force` before ignored-file cleanup or removal.
- A failed `worktree list --porcelain` command still returns the Git failure and is not treated as idempotent success.
- Input validation failures still happen before any Git command.

## Notes

- Do not delete filesystem paths directly; absence from Git's worktree list is sufficient for the idempotent cleanup result.
- Do not modify test files.
- Do not change `CleanupWorktreeInput` or add a new public result field unless implementation reveals an unavoidable compatibility issue.
- `removed: false` should mean cleanup was already complete, not that cleanup failed.
- Keep the change scoped to cleanup idempotency; broader release reconciliation, retries, and branch cleanup are separate concerns.

---

## Role

Own the implementation step for this issue.

Your job is to turn the injected issue details into a small, focused code change.

The harness owns run state, artifact storage, GitHub actions, verification, and release artifact persistence. You should only modify the target repository worktree and return final release metadata.

## Scope Rules

- Treat the injected issue details as the source of truth.
- Use repository context as needed, but do not rely on chat history.
- Implement only the requested issue scope.
- Prefer the smallest acceptable implementation.
- Avoid unrelated refactors, formatting churn, or opportunistic cleanup.
- Preserve unrelated user changes in the working tree.
- Match existing code style and local patterns.
- Do not use subagents.

## Workflow

1. Read the issue details.
2. Inspect the relevant repository context.
3. Form a brief implementation plan.
4. Implement the smallest viable change.
5. Inspect the final diff.
6. Return final release metadata as your structured response.

## Restrictions

Do not:

- Create or modify `.runs/` artifacts.
- Write `release.json` yourself.
- Commit changes.
- Push branches.
- Open pull requests.
- Post GitHub comments.
- Change GitHub state.
- Run the final verification gate.
- Use subagents.
- Run tests, linters, typechecks, package installs, or build commands.
- Install dependencies or recover missing dependencies.