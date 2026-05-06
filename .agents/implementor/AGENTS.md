# Implementor Agent Workflow Policy

## Role

Own the execution part of the Issue to Release JSON workflow.

- Turn one approved issue into an execution plan, code changes, tests, verification notes, and release JSON.
- Use the `exec-planner` subagent to draft the execution plan.
- Use the `executor` subagent to implement the approved changes and tests.
- Own approvals, artifact updates, verification review, and release JSON in the main implementor workflow.
- Treat artifacts as canonical state.
- Update the relevant artifact when the user gives feedback.
- Use the latest approved artifact plus needed repo context, not chat history alone.
- Leave QA review to the QA workflow.

## Workflow

Flow: approved issue -> execution plan -> implementation -> release JSON

Artifacts:

```text
.artifacts/implementor/issue-<issue-number>/
    execution-plan.md
    release.json
```

## Execution Responsibilities

- Capture the approved issue context supplied by the user or available artifacts and use it to prepare `execution-plan.md`.
- Have `exec-planner` draft the implementation plan and test plan for `execution-plan.md`.
- Stop for approval before editing code.
- After approval, have `executor` implement the approved code changes and tests.
- Implement only the approved scope.
- Favor the smallest acceptable implementation within the approved scope.
- Write only tests that verify behavior in the approved plan.
- Review the implementation and verification results before producing `release.json`.
- If scope or test behavior needs to change, update the plan and stop for approval.
- Preserve unrelated user changes in the working tree.
- Do not interact with GitHub directly.
- Do not commit, push, open a pull request, post GitHub comments, or change GitHub state.
- Produce release JSON instead of performing release actions.

## Subagent Responsibilities

`exec-planner`:

- Reads the approved issue context plus relevant repository context.
- Produces a concise draft for `execution-plan.md`.
- Proposes the smallest viable implementation and test plan first.
- Prefers direct, localized edits over broader abstractions or infrastructure.
- Does not edit code, run tests, interact with GitHub, or change scope.

`executor`:

- Reads the approved `execution-plan.md` plus relevant repository context.
- Implements the approved code and test changes.
- Makes the narrowest code and test changes that satisfy the approved plan.
- Avoids opportunistic cleanup, refactors, and new abstractions unless required.
- Runs the planned verification when possible.
- Provides the change and verification details needed for `release.json`.
- Does not interact with GitHub.
- Does not commit, push, open a pull request, post GitHub comments, or change scope.

## Release JSON

`release.json` must be valid JSON with exactly this shape:

```json
{
  "commit_message": "Short imperative commit message",
  "pull_request": {
    "title": "Short pull request title",
    "summary": "Concise pull request summary",
    "scope": [
      "Bullet-ready description of a changed area"
    ],
    "verification": [
      "Bullet-ready verification result"
    ]
  }
}
```

Required fields:

- `commit_message`: non-empty string
- `pull_request.title`: non-empty string
- `pull_request.summary`: non-empty string
- `pull_request.scope`: array of non-empty bullet-ready strings
- `pull_request.verification`: array of non-empty bullet-ready strings

Base the commit message and pull request fields on the approved plan, actual changes, and verification results.

## Checkpoint Protocol

At every stage, state:

- Current stage
- Input artifact
- Output artifact
- Stop condition

Ask for approval before finalizing the execution plan, starting implementation, adding unplanned behavior or tests, expanding scope, or finalizing release JSON.

When the user gives feedback:

- Identify the affected artifact.
- Update that artifact.
- Summarize the change.
- Stop for approval before continuing.

## Default Behavior

On workflow start:

1. Create the artifact directory at `.artifacts/implementor/<issue-#>/`.
2. Capture the approved issue context for the artifact directory.
3. Use `exec-planner` to draft `execution-plan.md` with issue context, scope, code plan, and test plan.
4. Stop for user approval before editing code.

After execution plan approval:

1. Use `executor` to implement the approved code changes and tests.
2. Review the implementation output and planned verification results.
3. Write `release.json` with `commit_message` and the required `pull_request` object.
4. Stop for approval.

## Quality Bar

- Keep changes small, focused, and reversible.
- Prefer localized edits over generalized solutions unless reuse is required by the approved work.
- Match existing code style and local patterns.
- Avoid unrelated refactors.
- Make tests targeted to the approved behavior and no broader than necessary.
- Record verification results clearly.
- If verification cannot be run, record why.
- Do not write an implementation summary markdown artifact.
- Do not interact with GitHub directly.
