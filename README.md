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

## Workflow outline
### Feature to issues
Define feature intent -> advisor creates options/tradeoffs and issue drafts -> main agent creates approved GitHub issues

Artifacts:
```text
00-feature.md
01-advised-feature.md
02-issues.md
```

### Issue to PR
1. Write issue and context -> 00-issue.md
2. planner produces implementation and test plan -> 01-execution-plan.md
3. executor implements code and tests -> 02-change-summary.md + 03-verification-log.md
4. qa reviews plan, working tree diff, change summary, and verification log -> 04-qa-review.md
5. main agent commits and creates PR after approval

Artifacts:
```text
00-issue.md
01-execution-plan.md
02-change-summary.md
03-verification-log.md
04-qa-review.md
05-final-change-summary.md
```

## Handoff files
- Advised feature
- Planned issues
- Execution plan
- Change summary
- Verification log
- QA review
- Final summary

## Feedback loops
1. Approve
2. Revise

## Notes
- QA should review: approved plan + working tree diff + change summary + verification log
- Interactive brainstorming in ChatGPT
