#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  loadPlannerPlan,
  type PlannerPlanIssueInput,
  type PlannerPlanResult
} from "./parser/plan.js";
import type { GitHubAutomationClient } from "./github/client.js";
import type { RepositorySelection } from "./github/types.js";
import { runPlannerIssueWorkflow } from "./workflow/create-issues.js";
import { runCleanupCli as runCleanupWorkflowLocalCli } from "./workflow/cleanup/cli-cleanup.js";
import { runImplementCli as runImplementWorkflowLocalCli } from "./workflow/implement/cli-implement.js";
import { runPrepareCli as runPrepareWorkflowLocalCli } from "./workflow/prepare/cli-prepare.js";
import { runReleaseCli as runReleaseWorkflowLocalCli } from "./workflow/release/cli-release.js";

export interface PlannerIssueCliOptions {
  planPath: string;
  repository?: RepositorySelection;
  dryRun: boolean;
}

export type CliOptions = PlannerIssueCliOptions;

export type WorkflowLocalCliRunner = (
  args: readonly string[],
  options?: {
    stdout?: (message: string) => void;
    stderr?: (message: string) => void;
  }
) => Promise<number>;

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
  runPrepareCli?: WorkflowLocalCliRunner;
  runImplementCli?: WorkflowLocalCliRunner;
  runReleaseCli?: WorkflowLocalCliRunner;
  runCleanupCli?: WorkflowLocalCliRunner;
}

export function formatUsage(): string {
  return [
    "Usage:",
    "  agent-workforce prepare [prepare options]",
    "  agent-workforce implement [implement options]",
    "  agent-workforce release [release publish options]",
    "  agent-workforce cleanup [cleanup options]",
    "  agent-workforce --plan <path> [--repo owner/name] [--dry-run]",
    "  agent-workforce-plan-issues --plan <path> [--repo owner/name] [--dry-run]",
    "",
    "Commands:",
    "  prepare            Run the staged prepare workflow.",
    "  implement          Run the staged implement workflow.",
    "  release            Publish the staged release workflow.",
    "  cleanup            Clean up an issue worktree and local branch.",
    "",
    "Legacy root modes:",
    "  --plan <path>       Create issues from a planner plan.json artifact.",
    "  --repo owner/name   Optional GitHub repository context.",
    "  --dry-run           Print a preview without creating GitHub resources."
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

  if (planPath !== undefined) {
    return {
      ok: true,
      value: {
        planPath,
        repository,
        dryRun
      }
    };
  }

  return usageFailure("--plan is required.");
}

export async function runCli(
  args: readonly string[],
  options: RunCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const loadPlan = options.loadPlan ?? loadPlannerPlan;

  const [command, ...commandArgs] = args;
  if (command === "prepare") {
    return (options.runPrepareCli ?? runPrepareWorkflowLocalCli)(commandArgs, {
      stdout,
      stderr
    });
  }

  if (command === "implement") {
    return (options.runImplementCli ?? runImplementWorkflowLocalCli)(commandArgs, {
      stdout,
      stderr
    });
  }

  if (command === "release") {
    return (options.runReleaseCli ?? runReleaseWorkflowLocalCli)(commandArgs, {
      stdout,
      stderr
    });
  }

  if (command === "cleanup") {
    return (options.runCleanupCli ?? runCleanupWorkflowLocalCli)(commandArgs, {
      stdout,
      stderr
    });
  }

  const parsed = parseCliArgs(args);

  if (!parsed.ok) {
    stderr([parsed.message, "", formatUsage()].join("\n"));
    return 1;
  }

  return runPlannerIssueWorkflow(parsed.value, {
    stdout,
    stderr,
    loadPlan,
    githubClient: options.githubClient,
    createGitHubClient: options.createGitHubClient
  });
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
