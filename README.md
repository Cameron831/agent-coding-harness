# Agent Coding Harness

## What It Is

Agent Coding Harness is a TypeScript CLI proof of concept for coordinating AI-assisted software delivery around GitHub issues.

It turns a GitHub issue into an isolated implementation workflow:

1. Read issue metadata.
2. Prepare a dedicated Git worktree and branch.
3. Generate an implementation prompt.
4. Run a Codex SDK implementer in the target worktree.
5. Verify the result.
6. Publish a commit and pull request.
7. Clean up local workspaces.


It supports:

- Per-issue Git worktree preparation with predictable branch names.
- Prompt generation for standard implementation flows.
- Codex SDK execution with structured release metadata output.
- Verification through Git state checks, changed-file detection, and an npm test command.
- Automatic implementation retry when verification fails.
- Release publishing through stage, commit, push, and pull request create/reuse.
- Cleanup for issue worktrees and local branches.
- Local eval cases for testing prompt and workflow behavior.

## CLI

| Command | Purpose |
| --- | --- |
| `npm run workflow:prepare -- --issue <number>` | Fetch the GitHub issue, create an issue worktree, and write prompt/run artifacts. |
| `npm run workflow:implement -- --issue <number>` | Run the Codex implementer, verify the change, and write release/diff artifacts. |
| `npm run workflow:implement -- --issue <number> --feedback "<text>"` | Re-run implementation with targeted feedback. |
| `npm run workflow:release -- --issue <number>` | Stage, commit, push, and open or reuse a pull request. |
| `npm run workflow:cleanup -- --issue <number>` | Remove the issue worktree and delete the local branch. |
| `npm run workflow:run -- --issue <number>` | Run prepare, implement, and release in sequence. |
| `npm run eval:run -- <case-id>` | Run a local workflow evaluation case. |

## Quick Start

Prerequisites:
- Node.js and npm
- Git
- GitHub CLI authenticated with gh auth login
- Codex SDK access configured in the local environment
- A target repository where issue branches and pull requests can be created

```text
npm install
npm run build
npm test

npm run workflow:prepare -- --issue 123
npm run workflow:implement -- --issue 123
npm run workflow:release -- --issue 123

Or run the full prepare-to-release path:
npm run workflow:run -- --issue 123

Cleanup is separate so local work can be inspected before removal:
npm run workflow:cleanup -- --issue 123
```

## Workflow Artifacts
| Artifact | Purpose |
| --- | --- |
| `issue.json` | Snapshot of the GitHub issue used as implementation input. |
| `prompt.md` | Generated prompt passed to the implementer. |
| `feedback-prompt.md` | Follow-up prompt generated for feedback or automatic retry. |
| `run.json` | Workflow state, including status, worktree path, branch, HEAD, and PR URL. |
| `release.json` | Structured commit and pull request metadata returned by the implementer. |
| `diff.patch` | Final working tree diff captured after implementation. |
| `verification.txt` | Verification report with Git checks, changed files, and test output. |

## What This Demonstrates

- Designing an AI-agent workflow as explicit, testable stages instead of one large script.
- Using TypeScript types and dependency injection to keep Git, GitHub, filesystem, and Codex boundaries testable.
- Preserving workflow state as inspectable artifacts for debugging and reruns.
- Handling idempotent release behavior, including existing branches and pull requests.
- Building verification into the automation loop rather than treating implementation as a black box.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).