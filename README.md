# agent-workforce
My personal AI agent workforce.

This repo is a lightweight workspace for experimenting with specialized AI agents that help with software development workflows, from planning and architecture to implementation and QA.

## Status
Early project. The agent list, responsibilities, and workflows are expected to evolve with use.

## Planned agents
- executor: write and execute code changes and tests
- qa: enforce best practices and catch edge cases
- advisor: advise on features and break them into scoped issues
- planner: break down issues into a combined implementation and test plan

## Goals
- keep agents small and specialized
- make responsibilities clear and non-overlapping
- improve development speed and consistency
- refine the system through real usage

## Local observability stack
Start the local stack:

```powershell
docker compose up -d
```

Services:
- Grafana: http://localhost:3000
- Prometheus: http://localhost:9090
- Loki: http://localhost:3100
- OpenTelemetry Collector OTLP gRPC: localhost:4317


## Optimizations
The original full pipeline was very robust but also time consuming and expensive to run. 

To optimize for time and token usage, these changes were made:
- Subagents no longer fork with context 
- Subagents now persist through the approval gate so revisions can be handled without creating a new agent
- Subagent roles were compressed or removed
- Created artifacts were reduced
- Prompts were simplified while maintaining the same guidelines

## Workflow outline
### Feature to issues
Define feature intent -> optional clarification -> planner writes `feature.md` for approval -> planner writes approved issue drafts to `plan.json`

Artifacts:
```text
.artifacts/planner/<feature-slug>/
    feature.md
    plan.json
```

### Issue to release JSON
1. Prepare the issue worktree and prompt from the approved issue context.
2. Run Codex in the target worktree with the prepared prompt.
3. Validate Codex final output as snake_case release metadata JSON.
4. Publish the release by committing, pushing, opening the pull request, and cleaning up the prepared worktree.

Artifacts:
```text
.artifacts/implementor/<issue-#>/
    execution-plan.md
    release.json
```

## Staged workflow commands
Build the project first:

```powershell
npm run build
```

Prepare an issue worktree and implementation prompt:

```powershell
npm run workflow -- prepare --issue <issue-number> --target-repo <target-repo-path> --worktree-parent <worktrees-parent-path> --repo owner/name
```

Run implementation against the prepared worktree:

```powershell
npm run workflow -- implement --issue <issue-number> --prompt .runs/issue-<issue-number>/prompt.md --worktree <worktree-path> --before-head <sha>
```

Publish the staged release workflow:

```powershell
npm run workflow -- release --release .runs/issue-<issue-number>/release.json --target-repo <target-repo-path> --worktree <worktree-path> --branch <branch-name> --base main --repo owner/name
```

The top-level `prepare`, `implement`, and `release` subcommands delegate to the workflow-local CLIs. Use those workflow-local usage messages as the source of truth for stage-specific options. The `release` subcommand is the publish workflow; root `--release` remains the legacy manual PR mode described below.

## Handoff files
- Feature spec
- JSON issue plan
- Execution plan
- QA review
- Release JSON

## Planner issue creation legacy root mode
Build the project, then preview the GitHub issues that would be created from a planner `plan.json` artifact:

```powershell
npm run build
npm run workflow -- --plan .artifacts/planner/<feature-slug>/plan.json --repo owner/name --dry-run
```

To create the issues in GitHub, omit `--dry-run`:

```powershell
npm run workflow -- --plan .artifacts/planner/<feature-slug>/plan.json --repo owner/name
```

The existing `npm run plan:issues -- --plan ...` script remains available for compatibility.

Live creation uses the local GitHub CLI authentication through the repository automation client. Before running it, install `gh`, authenticate with `gh auth login`, and make sure the authenticated account can create issues in the target repository. If `--repo` is omitted, the GitHub CLI repository context is used.

The command validates the full plan before creating the first issue. Creation is sequential in plan order and stops on the first failure. If a later issue fails, the output lists any issues already created so they can be reconciled manually.

Re-running live creation can create duplicate GitHub issues. Use `--dry-run` first and only run live mode once for a given approved plan unless duplicates are intended.

## Release pull request creation legacy root mode
Build the project, then preview the manual pull request that would be created from an implementor `release.json` artifact:

```powershell
npm run build
npm run workflow -- --release .artifacts/implementor/issue-<issue-number>/release.json --repo owner/name --dry-run
```

To create the pull request in GitHub, omit `--dry-run`:

```powershell
npm run workflow -- --release .artifacts/implementor/issue-<issue-number>/release.json --repo owner/name
```

The existing `npm run release:pr -- --release ...` script remains available for compatibility. This legacy manual PR mode is separate from `npm run workflow -- release`, which runs the staged release publish workflow.

The command validates release metadata with the implementor release parser and renders the pull request title and body from that artifact. If `--base` is omitted, the base branch defaults to `main`. If `--head` is omitted, the command resolves the current git branch; provide `--head <branch>` explicitly when running from a detached HEAD or another context where git cannot report the current branch. If `--repo` is omitted, the GitHub CLI repository context is used.

Live creation uses local GitHub CLI authentication through the repository automation client. Before running it, install `gh`, authenticate with `gh auth login`, and make sure the authenticated account can create pull requests in the target repository.

Re-running live creation can create duplicate GitHub pull requests. Use `--dry-run` first and only run live mode once for a given release artifact unless duplicates are intended.

## Target repository workflow
This repository coordinates agent workflow artifacts and release JSON. Code mutations happen in the target repository selected for the issue, usually from a separate git worktree.

Prerequisites:
- Git installed and available on `PATH`
- Node.js and npm installed for this workspace
- A clean target repository checkout with the needed remotes configured
- Permission to create branches and push to the target repository remote

Manual flow:
1. Create a target repository worktree and branch with `git -C <target-repo> worktree add -b <branch-name> <worktree-path> <base-ref>`.
2. Run the implementation agent from the target worktree so code edits and tests apply there.
3. Review and stage only the intended files with `git -C <worktree-path> add -- <files>`.
4. Commit with `git -C <worktree-path> commit -m "<message>"`.
5. Push with `git -C <worktree-path> push -u origin <branch-name>`.
6. After the worktree is clean and no longer needed, remove it with `git -C <target-repo> worktree remove <worktree-path>`.

The local git automation follows the same boundary: this workspace stores coordination artifacts, while git commands use explicit target repository or target worktree paths.

## Feedback loops
1. Approve
2. Revise
