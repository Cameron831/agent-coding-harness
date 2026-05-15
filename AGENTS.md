# Agent Workforce Policy

## Role

This repository defines three focused agents. Use the agent-specific prompt for workflow details.

## Agents

### Planner

Use `.agents/planner/AGENTS.md` for Feature to Issues work:

- Turn a feature request into an approved `feature.md`.
- Clarify the request when useful, then write `feature.md`.
- Draft a small, reviewable JSON issue plan after feature approval.
- Stop after the user approves the JSON issue plan.

### QA

Use `.agents/qa/AGENTS.md` for PR review work:

- Investigate a given PR.
- Report bugs, regressions, missing tests, and scope drift.
- Remain read-only unless explicitly asked otherwise.

## Shared Rules

- Treat artifacts as canonical state when a workflow defines them.
- Preserve unrelated user changes in the working tree.
- Prefer the smallest acceptable solution that satisfies the task.
- Treat extra abstraction, refactoring, cleanup, and scope expansion as out of bounds unless they are required or explicitly approved.
- Ask before expanding approved scope.
- Do not commit, push, open PRs, post GitHub comments, approve, request changes, merge, or make code changes unless the active workflow or user request allows it.
- Prefer concise, decision-oriented artifacts and reports.
