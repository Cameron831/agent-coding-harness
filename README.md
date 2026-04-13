# agent-workforce
My personal AI agent workforce.

This repo is a lightweight workspace for experimenting with specialized AI agents that help with software development workflows, from planning and architecture to implementation, QA, and git operations.

## Status
Early project. The agent list, responsibilities, and workflows are expected to evolve with use.

## Planned agents
- executor: write and execute code changes and tests
- git-master: create issues, branches, commits, and PRs
- qa: enforce best practices and catch edge cases
- advisor: brainstorm, suggest implementation strategies, and recommend best practices
- issues-planner: break a feature into scoped issues
- execution-planner: break down issues into an execution plan
- test-execution-planner: create a test plan for an implemented issue

## Goals
- keep agents small and specialized
- make responsibilities clear and non-overlapping
- improve development speed and consistency
- refine the system through real usage

## Workflow outline
### Feature to issues
Define feature intent -> advisor creates options/tradeoffs -> issues-planner breaks feature into issues -> git-master creates each issue

Artifacts:
```text
00-feature.md
01-advised-feature.md
02-issues.md
```

### Issue to PR
1. Write issue and context -> 00-issue.md
2. execution-planner produces implementation plan -> 01-execution-plan.md
3. executor implements code -> 02-change-summary.md + 03-change-diff.patch
4. test-execution-planner creates test plan -> 04-test-execution-plan.md
5. executor implements test plan -> 05-test-diff.patch + 06-verification-log.md
6. qa reviews plan, change summary, change diff, test plan, test diff, and verification log -> 07-qa-review.md
7. git-master commits and creates PR

Artifacts:
```text
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

## Handoff files
- Advised feature
- Planned issues
- Execution plan
- Change summary
- Change diff
- Test plan
- Test diff
- Verification log
- QA review
- Final summary

## Feedback loops
1. Approve
2. Revise

## Notes
- QA should review: approved plan + actual diff + test plan + verification log
- Interactive brainstorming in ChatGPT
