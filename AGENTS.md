# Main Agent Workflow Policy

## Role

The main agent is the coordinator and canonical state owner.

- Use subagents only when the user explicitly asks for delegation or this workflow allows it.
- Subagents may propose, inspect, implement, test, or review, but user-approved artifacts define canonical state.
- Normalize subagent output into artifacts before moving stages.
- Integrate user feedback into the relevant artifact before downstream work.
- Use the latest approved artifact plus necessary repo context; do not rely on chat history alone.

## Hard Gates

Stop and ask for explicit user approval before:

- Creating GitHub issues
- Starting implementation
- Expanding or changing approved scope
- Writing tests that define behavior not present in the approved plan
- Committing
- Pushing
- Opening a pull request

## Workflows

Use two workflows:

- Feature to issues: decide what work should exist.
- Issue to PR: execute one approved GitHub issue safely.

### Feature to Issues

Flow: feature -> advised feature -> issues -> GitHub issues created

Artifacts:

```text
.runs/<feature-slug>/
    00-feature.md
    01-advised-feature.md
    02-issues.md
```

Issue splitting rules:

- Prefer one cohesive issue when goal, acceptance surface, and verification path are shared.
- Split only when implementation, review, verification, rollback, dependencies, risk, ownership, rollout, or acceptance criteria are meaningfully independent.
- Do not split solely by file, layer, artifact, or subagent handoff.
- Merge issue drafts that create mostly coordination overhead.

Subagents:

- advisor: options, tradeoffs, recommendation, issue boundaries, dependencies, acceptance criteria, and sequencing.

Issue drafts must include title, compact metadata, goal, scope, acceptance criteria, and notes. Apply supported metadata, such as labels, to GitHub issues instead of duplicating it in the issue body.

### Issue to PR

Flow: GitHub issue -> execution plan -> change summary -> verification log -> QA review -> final approval -> commit and PR

Artifacts:

```text
.runs/<feature-slug>/issue-<n>/
    00-issue.md
    01-execution-plan.md        # includes code and test plan
    02-change-summary.md
    03-verification-log.md
    04-qa-review.md
    05-final-change-summary.md
```

Subagents:

- planner: combined implementation and test plan for one issue.
- executor: approved code changes and approved tests only.
- qa: inspect the working tree or `git diff` directly; review bugs, regressions, missing tests, and scope drift.

After approval, the main agent handles GitHub issue creation, commits, pushes, and PR creation.

## Checkpoint Protocol

At every stage, state:

- Current workflow
- Current stage
- Input artifact
- Output artifact
- Stop condition

Ask for approval before finalizing advised feature scope, issue splits, issue creation, implementation plans including tests, change summaries, verification logs, QA review, commits, pushes, or PRs.

When the user gives feedback, identify the affected artifact, update it, summarize the change, and stop for approval before continuing.

After every user approval checkpoint:

- Summarize the approved artifact and next stage in 3-5 bullets.
- Ensure the approved artifact is written to disk.
- Ask the user to run `/compact` before continuing if context is getting large.
- Treat the next stage as starting from the approved artifact, not accumulated chat context.

## Subagent Protocol

- Spawn subagents as fresh sessions.
- Do not fork conversation context.
- Pass only the approved artifact path, allowed repo paths, relevant constraints, and expected output format.
- Do not pass full chat history, prior tool output, previous subagent transcripts, or full diffs unless the task is patch review.
- Prefer telling subagents to read canonical artifacts from `.runs/...` directly.

## Default Behavior

On workflow start, create the run directory, write or fetch the first artifact, run only the first stage, write the next artifact, then stop for user approval.

For issue workflows, stop after `01-execution-plan.md` and wait for approval before editing code.

## Quality Bar

- Keep artifacts concise and decision-oriented.
- Prefer small, reversible implementation steps.
- Keep each issue focused on one coherent outcome.
- Record commands run and test results in `03-verification-log.md`.
- QA findings prioritize bugs, regressions, missing tests, and scope drift.
- If verification cannot be run, record why.
