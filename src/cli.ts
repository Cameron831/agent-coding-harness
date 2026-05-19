#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  loadPlannerPlan,
  type PlannerPlanIssueInput,
  type PlannerPlanResult
} from "./parser/plan.js";
import {
  loadReleaseJson,
  type ImplementorReleaseMetadata,
  type ReleaseJsonResult
} from "./parser/release.js";
import type { GitHubAutomationClient } from "./github/client.js";
import type { RepositorySelection } from "./github/types.js";
import {
  LocalGitCommandRunner,
  type GitCommandRunner
} from "./git/git-runner.js";
import { runPlannerIssueWorkflow } from "./workflow/create-issues.js";
import {
  runReleasePullRequestWorkflow,
  type BranchResolutionResult,
  type ReleasePullRequestWorkflowOptions
} from "./workflow/create-pull-request.js";
import { runCleanupCli as runCleanupWorkflowLocalCli } from "./workflow/cleanup/cli-cleanup.js";
import { runImplementCli as runImplementWorkflowLocalCli } from "./workflow/implement/cli-implement.js";
import { runPrepareCli as runPrepareWorkflowLocalCli } from "./workflow/prepare/cli-prepare.js";
import { runReleaseCli as runReleaseWorkflowLocalCli } from "./workflow/release/cli-release.js";

export interface PlannerIssueCliOptions {
  planPath: string;
  repository?: RepositorySelection;
  dryRun: boolean;
}

export type ReleasePullRequestCliOptions = ReleasePullRequestWorkflowOptions;

export type CliOptions = PlannerIssueCliOptions | ReleasePullRequestCliOptions;

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
  loadRelease?: (
    path: string
  ) => Promise<ReleaseJsonResult<ImplementorReleaseMetadata>>;
  resolveCurrentBranch?: () => Promise<BranchResolutionResult>;
  gitRunner?: GitCommandRunner;
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
    "  agent-workforce --release <path> [--repo owner/name] [--base branch] [--head branch] [--dry-run]",
    "  agent-workforce-plan-issues --plan <path> [--repo owner/name] [--dry-run]",
    "  agent-workforce-release-pr --release <path> [--repo owner/name] [--base branch] [--head branch] [--dry-run]",
    "",
    "Commands:",
    "  prepare            Run the staged prepare workflow.",
    "  implement          Run the staged implement workflow.",
    "  release            Publish the staged release workflow.",
    "  cleanup            Clean up an issue worktree and local branch.",
    "",
    "Legacy root modes:",
    "  --plan <path>       Create issues from a planner plan.json artifact.",
    "  --release <path>    Create a manual PR from release.json; distinct from the release publish subcommand.",
    "  --repo owner/name   Optional GitHub repository context.",
    "  --base branch       Manual PR base branch. Defaults to main.",
    "  --head branch       Manual PR head branch. Defaults to the current branch.",
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
  let releasePath: string | undefined;
  let repository: RepositorySelection | undefined;
  let base: string | undefined;
  let head: string | undefined;
  let dryRun = false;
  let releaseSpecificOptionUsed = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (
      arg === "--plan" ||
      arg === "--release" ||
      arg === "--repo" ||
      arg === "--base" ||
      arg === "--head"
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return usageFailure(`${arg} requires a value.`);
      }

      if (arg === "--plan") {
        if (planPath !== undefined) {
          return usageFailure("--plan may only be provided once.");
        }
        planPath = value;
      } else if (arg === "--release") {
        if (releasePath !== undefined) {
          return usageFailure("--release may only be provided once.");
        }
        releasePath = value;
        releaseSpecificOptionUsed = true;
      } else if (arg === "--repo") {
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
      } else if (arg === "--base") {
        if (base !== undefined) {
          return usageFailure("--base may only be provided once.");
        }
        base = value;
        releaseSpecificOptionUsed = true;
      } else {
        if (head !== undefined) {
          return usageFailure("--head may only be provided once.");
        }
        head = value;
        releaseSpecificOptionUsed = true;
      }

      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      return usageFailure(`Unknown option: ${arg}.`);
    }

    return usageFailure(`Unexpected positional argument: ${arg}.`);
  }

  if (planPath !== undefined && releasePath !== undefined) {
    return usageFailure("--plan and --release cannot be used together.");
  }

  if (planPath !== undefined) {
    if (base !== undefined) {
      return usageFailure("--base requires --release.");
    }

    if (head !== undefined) {
      return usageFailure("--head requires --release.");
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

  if (releasePath !== undefined) {
    return {
      ok: true,
      value: {
        releasePath,
        repository,
        base: base ?? "main",
        ...(head !== undefined ? { head } : {}),
        dryRun
      }
    };
  }

  if (releaseSpecificOptionUsed) {
    return usageFailure("--release is required.");
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
  const loadRelease = options.loadRelease ?? loadReleaseJson;

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

  if ("releasePath" in parsed.value) {
    return runReleasePullRequestWorkflow(parsed.value, {
      stdout,
      stderr,
      loadRelease,
      resolveCurrentBranch:
        options.resolveCurrentBranch ??
        (() => resolveCurrentBranch(options.gitRunner ?? new LocalGitCommandRunner())),
      githubClient: options.githubClient,
      createGitHubClient: options.createGitHubClient
    });
  }

  return runPlannerIssueWorkflow(parsed.value, {
    stdout,
    stderr,
    loadPlan,
    githubClient: options.githubClient,
    createGitHubClient: options.createGitHubClient
  });
}

async function resolveCurrentBranch(
  runner: GitCommandRunner
): Promise<BranchResolutionResult> {
  let result;
  try {
    result = await runner.run(["branch", "--show-current"]);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  if (result.exitCode !== 0) {
    return {
      ok: false,
      message: result.stderr.trim() || `git exited with code ${result.exitCode}.`
    };
  }

  const branchName = result.stdout.trim();
  if (branchName === "") {
    return {
      ok: false,
      message: "git did not report a current branch."
    };
  }

  return { ok: true, branchName };
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
