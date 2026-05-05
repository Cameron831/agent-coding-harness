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

### Issue to release metadata
1. Capture the approved issue context.
2. exec-planner produces `execution-plan.md`.
3. executor implements the approved code and tests.
4. implementor verifies the result and produces `release-metadata.json`.

Artifacts:
```text
.artifacts/implementor/<issue-#>/
    execution-plan.md
    release-metadata.json
```

## Handoff files
- Feature spec
- JSON issue plan
- Execution plan
- QA review
- Release metadata JSON

## Feedback loops
1. Approve
2. Revise
