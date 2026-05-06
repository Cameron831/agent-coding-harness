#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  loadPlannerPlan,
  renderPlannerIssueInput,
  type PlannerPlanIssueInput,
  type PlannerPlanResult,
  type PlannerPlanValidationError
} from "./planner/plan.js";
import { GhGitHubAutomationClient } from "./github/gh-client.js";
import type { GitHubAutomationClient } from "./github/client.js";
import type {
  CreateIssueInput,
  IssueDetails,
  RepositorySelection
} from "./github/types.js";

export interface CliOptions {
  planPath: string;
  repository?: RepositorySelection;
  dryRun: boolean;
}

export type CliParseResult =
  | {
      ok: true;
      value: CliOptions;
    }
  | {
      ok: false;
      message: string;
    };

export interface RunCliOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  loadPlan?: (
    path: string
  ) => Promise<PlannerPlanResult<PlannerPlanIssueInput[]>>;
  githubClient?: GitHubAutomationClient;
  createGitHubClient?: () => GitHubAutomationClient;
}

export function formatUsage(): string {
  return [
    "Usage: agent-workforce-plan-issues --plan <path> [--repo owner/name] [--dry-run]",
    "",
    "Options:",
    "  --plan <path>       Path to a planner plan.json artifact.",
    "  --repo owner/name   Optional GitHub repository context.",
    "  --dry-run           Print planned issues without creating them."
  ].join("\n");
}

export function parseRepository(value: string): RepositorySelection {
  if (value !== value.trim()) {
    throw new Error("Repository must use exact owner/name format.");
  }

  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    parts[0] === "" ||
    parts[1] === "" ||
    /\s/.test(parts[0]) ||
    /\s/.test(parts[1])
  ) {
    throw new Error("Repository must use exact owner/name format.");
  }

  return { owner: parts[0], name: parts[1] };
}

export function parseCliArgs(args: readonly string[]): CliParseResult {
  let planPath: string | undefined;
  let repository: RepositorySelection | undefined;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--plan" || arg === "--repo") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return usageFailure(`${arg} requires a value.`);
      }

      if (arg === "--plan") {
        if (planPath !== undefined) {
          return usageFailure("--plan may only be provided once.");
        }
        planPath = value;
      } else {
        if (repository !== undefined) {
          return usageFailure("--repo may only be provided once.");
        }

        try {
          repository = parseRepository(value);
        } catch (error) {
          return usageFailure(
            error instanceof Error
              ? error.message
              : "Repository must use exact owner/name format."
          );
        }
      }

      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      return usageFailure(`Unknown option: ${arg}.`);
    }

    return usageFailure(`Unexpected positional argument: ${arg}.`);
  }

  if (planPath === undefined) {
    return usageFailure("--plan is required.");
  }

  return {
    ok: true,
    value: {
      planPath,
      repository,
      dryRun
    }
  };
}

export async function runCli(
  args: readonly string[],
  options: RunCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const loadPlan = options.loadPlan ?? loadPlannerPlan;
  const parsed = parseCliArgs(args);

  if (!parsed.ok) {
    stderr([parsed.message, "", formatUsage()].join("\n"));
    return 1;
  }

  const plan = await loadPlan(parsed.value.planPath);
  if (!plan.ok) {
    stderr(formatValidationErrors(plan.errors));
    return 1;
  }

  if (parsed.value.dryRun) {
    stdout(formatDryRunOutput(plan.value, parsed.value.repository));
    return 0;
  }

  const client =
    options.githubClient ??
    options.createGitHubClient?.() ??
    new GhGitHubAutomationClient();

  return createPlannerIssues(plan.value, parsed.value.repository, client, stdout, stderr);
}

async function createPlannerIssues(
  issues: readonly PlannerPlanIssueInput[],
  repository: RepositorySelection | undefined,
  client: GitHubAutomationClient,
  stdout: (message: string) => void,
  stderr: (message: string) => void
): Promise<number> {
  const createdIssues: IssueDetails[] = [];

  for (const [index, issue] of issues.entries()) {
    const input = toCreateIssueInput(issue, repository);
    const result = await client.createIssue(input);

    if (!result.ok) {
      stderr(
        formatIssueCreationFailure(
          createdIssues,
          index + 1,
          input.title,
          result.error.message
        )
      );
      return 1;
    }

    createdIssues.push(result.value);
  }

  stdout(formatIssueCreationSuccess(createdIssues));
  return 0;
}

function toCreateIssueInput(
  issue: PlannerPlanIssueInput,
  repository: RepositorySelection | undefined
): CreateIssueInput {
  const rendered = renderPlannerIssueInput(issue);
  return {
    repository,
    title: rendered.title,
    body: rendered.body
  };
}

function formatDryRunOutput(
  issues: readonly PlannerPlanIssueInput[],
  repository: RepositorySelection | undefined
): string {
  const lines = [
    `Planner issue dry run: ${issues.length} issue${issues.length === 1 ? "" : "s"}`
  ];

  if (repository) {
    lines.push(`Repository: ${repository.owner}/${repository.name}`);
  }

  issues.forEach((issue, index) => {
    const rendered = renderPlannerIssueInput(issue);
    lines.push("", `Issue ${index + 1}: ${rendered.title}`, "", rendered.body);
  });

  return lines.join("\n");
}

function formatValidationErrors(
  errors: readonly PlannerPlanValidationError[]
): string {
  return [
    "Planner plan validation failed:",
    ...errors.map((error) => `- ${error.message}`)
  ].join("\n");
}

function formatIssueCreationSuccess(createdIssues: readonly IssueDetails[]): string {
  return [
    `Created ${createdIssues.length} GitHub issue${createdIssues.length === 1 ? "" : "s"}:`,
    ...formatCreatedIssueLines(createdIssues)
  ].join("\n");
}

function formatIssueCreationFailure(
  createdIssues: readonly IssueDetails[],
  issueIndex: number,
  title: string,
  message: string
): string {
  const lines = [
    `GitHub issue creation failed at issue ${issueIndex}: ${title}`,
    message
  ];

  if (createdIssues.length > 0) {
    lines.push(
      "",
      `Created ${createdIssues.length} GitHub issue${createdIssues.length === 1 ? "" : "s"} before failure:`,
      ...formatCreatedIssueLines(createdIssues)
    );
  }

  return lines.join("\n");
}

function formatCreatedIssueLines(createdIssues: readonly IssueDetails[]): string[] {
  return createdIssues.map(
    (issue) => `- #${issue.issueNumber}: ${issue.title} (${issue.url})`
  );
}

function usageFailure(message: string): CliParseResult {
  return { ok: false, message };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
