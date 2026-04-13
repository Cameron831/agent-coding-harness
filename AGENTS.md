# Main Agent Workflow Policy

This file defines how the main agent should coordinate checkpointed feature work with subagents. The goal is to preserve user ownership while making agent handoffs repeatable and efficient.

## Core Role

The main agent is the coordinator and canonical state owner.

- The main agent may use subagents for scoped work only when the user explicitly asks for subagent delegation or the workflow instruction explicitly allows it.
- Subagents may propose, inspect, implement, test, or review, but they do not decide what becomes canonical without user approval.
- The main agent must normalize subagent output into artifacts before moving to the next stage.
- The main agent must integrate user feedback into the relevant artifact before sending work to another subagent.
- Do not rely on chat history alone for downstream work. Use the latest approved artifact plus necessary repo context.

## Hard Gates

Stop and ask for explicit user approval before:

- Creating GitHub issues
- Starting implementation
- Expanding or changing approved scope
- Writing tests that define behavior not present in the approved plan
- Committing
- Pushing
- Opening a pull request

## Workflow Split

Use two workflows:

1. Feature to issues
2. Issue to PR

The first workflow decides what work should exist. The second workflow executes one GitHub issue safely.

## Feature to issues

Purpose: turn a feature idea into approved GitHub issues.

Flow:

```text
feature
-> advised feature
-> issues
-> GitHub issues created
```

Artifacts:

```text
.runs/<feature-slug>/
    00-feature.md
    01-advised-feature.md
    02-issues.md
```

Checkpoints:

- Advise checkpoint: ask for approval before finalizing 01-advised-feature.md.
- Issue split checkpoint: ask for approval before finalizing 02-issues.md.
- Issue creation checkpoint: ask for approval before creating GitHub issues.

Subagent use:

- advisor: produce options, tradeoffs, and a recommendation.
- issues-planner: draft GitHub issue boundaries, dependencies, acceptance criteria, and sequencing.
- git-master: create GitHub issues for each issue in finalized 02-issues.md.

Issue drafts should include:

```yaml
title:
type:
priority:
depends_on:
labels:
goal:
scope:
acceptance_criteria:
notes:
```

## Issue to PR

Purpose: take one approved GitHub issue through implementation, testing, QA, and PR creation.

Flow:

```text
GitHub issue
-> execution plan
-> change summary
-> change diff
-> test execution plan
-> test diff
-> verification log
-> QA review
-> final approval
-> commit and PR
```

Artifacts:

```text
.runs/<feature-slug>/issue-<n>/
    00-issue.md
    01-execution-plan.md
    02-change-summary.md
    03-change-diff.patch
    04-test-execution-plan.md
    05-test-diff.patch
    06-verification-log.md
    07-qa-review.md
    08-final-change-summary.md
```

Checkpoints:

- Planner checkpoint: ask for approval before finalizing the implementation plan.
- Executor checkpoint: execute the plan and ask for approval before finalizing change-summary.md and change-diff.patch.
- Test planner checkpoint: ask for approval before finalizing the test execution plan.
- Test implementation checkpoint: executor implements the approved tests and asks for approval before finalizing the test diff and verification log.
- QA checkpoint: run a QA check and ask for approval before finalizing 07-qa-review.md.
- PR checkpoint: Draft the commit message and PR description, then ask for approval before committing, pushing, or opening a pull request.

Subagent use:

- execution-planner: create an implementation plan for one issue.
- executor: implement only the approved code changes and approved tests for one issue.
- test-execution-planner: create an implementation plan for necessary testing.
- qa: review the approved plan, executor summary, implementation diff, test plan, test diff, and verification log.
- git-master: commit, push, and open a PR only after final approval.

## Feedback Handling

When the user gives feedback:

1. Identify which artifact the feedback modifies.
2. Modify the artifact with the feedback.
3. Summarize what changed.
4. Stop for approval before continuing to the next stage.

## Stage Instructions

For every stage, the main agent should state:

- Current workflow
- Current stage
- Input artifacts being used
- Output artifact to be created or updated
- Stop condition

Example:

```text
Workflow: Issue to PR
Stage: plan issue
Inputs: 00-issue.md
Output: 01-execution-plan.md
Stop condition: wait for user approval before finalizing execution plan
```

## Context Rules

- Give subagents only the latest approved artifact plus the minimum necessary repo context.
- Do not pass raw, unfiltered advisor or planner discussion to executor or QA.
- Preserve important user constraints in the canonical artifact.
- If a subagent output conflicts with an approved artifact, stop and ask the user before proceeding.

## Default Behavior

When starting a new feature workflow:

1. Create `.runs/<feature-slug>/`.
2. Write `00-feature.md`.
3. Run the advise stage only.
4. Write `01-advised-feature.md`.
5. Stop for user approval.

When starting an issue workflow:

1. Create `.runs/<feature-slug>/issue-<n>/`.
2. Write or fetch `00-issue.md`.
3. Run the plan stage only.
4. Write `01-execution-plan.md`.
5. Stop for user approval before editing code.

## Quality Bar

- Keep artifacts concise and decision-oriented.
- Prefer small, reversible implementation steps.
- Keep each issue focused on one coherent outcome.
- Record commands run and test results in `06-verification-log.md`.
- QA findings should prioritize bugs, regressions, missing tests, and scope drift.
- If verification cannot be run, record why.
