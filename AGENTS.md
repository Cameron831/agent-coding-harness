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

Pipeline Modes:

Before starting a Feature to issues workflow, classify the feature as Lightweight, Standard, or Full and record the selected mode and reasoning in the first workflow update.

Hard gates still apply in every mode: ask before finalizing advised feature scope, finalizing issue splits, or creating GitHub issues.

If the feature is already clear and small, prefer Lightweight Mode rather than expanding analysis or splitting the work artificially.

1. Lightweight Mode

Use for small, clear features where the desired outcome, acceptance criteria, and issue boundary are already obvious.

Flow:

```text
feature
-> issue draft
-> GitHub issue created
```

Required artifacts:

```text
.runs/<feature-slug>/00-feature.md
.runs/<feature-slug>/02-issues.md
```

Subagents: use only if explicitly requested or if ambiguity justifies it. Skip advisor and issues-planner subagents unless needed.

2. Standard Mode

Use for normal feature requests that need scope clarification, tradeoff review, or issue boundary planning.

Flow:

```text
feature
-> advised feature
-> issues
-> GitHub issues created
```

Subagents:

- advisor: produce options, tradeoffs, and a recommendation when scope or approach is not obvious.
- issues-planner: draft focused GitHub issue boundaries, dependencies, acceptance criteria, and sequencing.

3. Full Mode

Use for broad, ambiguous, risky, or cross-cutting features where multiple implementation paths, dependencies, or rollout concerns need explicit review.

Use the full existing Feature to issues workflow and artifact set.

Issue splitting rules:

- Prefer one cohesive issue when the work has one goal, one acceptance surface, and one verification path.
- Do not split solely by file, layer, artifact, or subagent handoff.
- Split only when issues can be implemented, reviewed, verified, and rolled back independently.
- Split when dependencies, risk, ownership, rollout order, or acceptance criteria are meaningfully different.
- If a split creates issues that are mostly coordination overhead, merge them back into the parent issue draft.

Checkpoints:

- Advise checkpoint: ask for approval before finalizing 01-advised-feature.md when that artifact is used.
- Issue split checkpoint: ask for approval before finalizing 02-issues.md.
- Issue creation checkpoint: ask for approval before creating GitHub issues.

Subagent use:

- advisor: produce options, tradeoffs, and a recommendation.
- issues-planner: draft GitHub issue boundaries, dependencies, acceptance criteria, and sequencing.
- git-master: create GitHub issues for each issue in finalized 02-issues.md.

Issue drafts should include:

```markdown
## Issue N: Title
Metadata: type; priority; depends_on; labels

Goal:

Scope:

Acceptance Criteria:

Notes:
```

Keep metadata compact. Do not create separate body sections for `type`, `priority`, `depends_on`, or `labels` when each would only contain a bullet or two. When creating GitHub issues, apply supported metadata such as labels to the issue itself instead of duplicating it in the body.

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

Pipeline Modes:

Before starting an Issue to PR workflow, classify the issue as Lightweight, Standard, or Full and record the selected mode and reasoning in the first workflow update.

Hard gates still apply in every mode: ask before starting implementation, expanding or changing approved scope, writing tests that define new behavior, committing, pushing, or opening a pull request.

If a planned issue is so small that the full workflow overhead is larger than the implementation risk, prefer Lightweight Mode rather than expanding the issue artificially.

1. Lightweight Mode

Use for small, low-risk issues such as one-file changes, documentation-only changes, simple SQL/schema edits without runtime behavior changes, mechanical edits with clear acceptance criteria, or changes where automated tests are explicitly out of scope.

Flow:

```text
GitHub issue
-> execution plan
-> implementation
-> verification log
-> final approval
-> commit and PR
```

Required artifacts:

```text
.runs/<feature-slug>/issue-<n>/00-issue.md
.runs/<feature-slug>/issue-<n>/01-execution-plan.md
.runs/<feature-slug>/issue-<n>/02-change-summary.md
.runs/<feature-slug>/issue-<n>/03-change-diff.patch
.runs/<feature-slug>/issue-<n>/06-verification-log.md
.runs/<feature-slug>/issue-<n>/08-final-change-summary.md
```

Subagents: use only if explicitly requested or if risk justifies it; prefer at most one implementation or review subagent. Skip separate test-planner and QA subagents unless needed.

2. Standard Mode

Use for normal implementation issues with moderate risk, multiple files, or meaningful tests.

Flow:

```text
GitHub issue
-> execution plan
-> change summary
-> change diff
-> test plan
-> verification log
-> QA review
-> final approval
-> commit and PR
```

Subagents:

- execution-planner: create an implementation plan for one issue.
- executor: implement the approved changes.
- test-execution-planner: create a test plan when tests are needed.
- qa: review behavior or regression risk when non-trivial.

3. Full Mode

Use for large, risky, or cross-cutting issues such as persistence behavior, Docker/database initialization, CI changes, multi-module app behavior, user-facing behavior changes, or work where missing tests would create meaningful risk.

Use the full existing Issue to PR workflow and artifact set.

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

## Token Budget Rules
Use repo artifacts as canonical state. Do not rely on chat history for downstream workflow stages.

When using subagents:
- Spawn subagents as fresh sessions.
- Do not fork conversation context.
- Use `fork_context: false` when the tool supports it, or omit `fork_context` if false is the default.
- Give each subagent only:
- the latest approved artifact path;
- specific repo paths it may inspect;
- relevant user constraints;
- the expected output format.
- Do not pass full chat history, prior tool output, previous subagent transcripts, or full diffs unless the task is patch review.
- Prefer telling subagents to read canonical artifacts from `.runs/...` directly.

After each approved workflow stage:
- Ensure the canonical artifact is written.
- Keep chat summaries short and reference artifact paths instead of restating content.
- Treat the next stage as starting from the approved artifact, not from accumulated chat context.


## Default Behavior

When starting a new feature workflow:

1. Create `.runs/<feature-slug>/`.
2. Classify the feature as Lightweight, Standard, or Full and record the reasoning.
3. Write `00-feature.md`.
4. Run only the first stage required by the selected mode.
5. Write the next required artifact for that mode.
6. Stop for user approval before continuing.

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
- Avoid splitting issues smaller than their independent implementation and verification value.
- Record commands run and test results in `06-verification-log.md`.
- QA findings should prioritize bugs, regressions, missing tests, and scope drift.
- If verification cannot be run, record why.
