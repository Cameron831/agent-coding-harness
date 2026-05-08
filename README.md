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
4. A future artifact writer or release PR sequence can persist or publish the validated metadata.

Artifacts:
```text
.artifacts/implementor/<issue-#>/
    execution-plan.md
    release.json
```

## Handoff files
- Feature spec
- JSON issue plan
- Execution plan
- QA review
- Release JSON

## Planner issue creation
Build the project, then preview the GitHub issues that would be created from a planner `plan.json` artifact:

```powershell
npm run build
npm run plan:issues -- --plan .artifacts/planner/<feature-slug>/plan.json --repo owner/name --dry-run
```

To create the issues in GitHub, omit `--dry-run`:

```powershell
npm run plan:issues -- --plan .artifacts/planner/<feature-slug>/plan.json --repo owner/name
```

Live creation uses the local GitHub CLI authentication through the repository automation client. Before running it, install `gh`, authenticate with `gh auth login`, and make sure the authenticated account can create issues in the target repository. If `--repo` is omitted, the GitHub CLI repository context is used.

The command validates the full plan before creating the first issue. Creation is sequential in plan order and stops on the first failure. If a later issue fails, the output lists any issues already created so they can be reconciled manually.

Re-running live creation can create duplicate GitHub issues. Use `--dry-run` first and only run live mode once for a given approved plan unless duplicates are intended.

## Release pull request creation
Build the project, then preview the pull request that would be created from an implementor `release.json` artifact:

```powershell
npm run build
npm run release:pr -- --release .artifacts/implementor/issue-<issue-number>/release.json --repo owner/name --dry-run
```

To create the pull request in GitHub, omit `--dry-run`:

```powershell
npm run release:pr -- --release .artifacts/implementor/issue-<issue-number>/release.json --repo owner/name
```

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
