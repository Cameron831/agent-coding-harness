#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  loadPlannerPlan,
  type PlannerPlanIssueInput,
  type PlannerPlanResult
} from "./parser/plan.js";
import {
  loadReleaseJson,
  renderReleasePullRequestInput,
  type ImplementorReleaseMetadata,
  type ReleaseJsonResult,
  type ReleaseValidationError
} from "./parser/release.js";
import { GhGitHubAutomationClient } from "./github/gh-client.js";
import type { GitHubAutomationClient } from "./github/client.js";
import type {
  CreatePullRequestInput,
  PullRequestDetails,
  RepositorySelection
} from "./github/types.js";
import {
  LocalGitCommandRunner,
  type GitCommandRunner
} from "./git/git-runner.js";
import { runPlannerIssueWorkflow } from "./workflow/planner-issues.js";

export interface PlannerIssueCliOptions {
  planPath: string;
  repository?: RepositorySelection;
  dryRun: boolean;
}

export interface ReleasePullRequestCliOptions {
  releasePath: string;
  repository?: RepositorySelection;
  base: string;
  head?: string;
  dryRun: boolean;
}

export type CliOptions = PlannerIssueCliOptions | ReleasePullRequestCliOptions;

export type CliParseResult =
  | {
      ok: true;
      value: CliOptions;
    }
  | {
      ok: false;
      message: string;
    };

export type BranchResolutionResult =
  | {
      ok: true;
      branchName: string;
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
}

export function formatUsage(): string {
  return [
    "Usage:",
    "  agent-workforce-plan-issues --plan <path> [--repo owner/name] [--dry-run]",
    "  agent-workforce-release-pr --release <path> [--repo owner/name] [--base branch] [--head branch] [--dry-run]",
    "",
    "Options:",
    "  --plan <path>       Path to a planner plan.json artifact.",
    "  --release <path>    Path to an implementor release.json artifact.",
    "  --repo owner/name   Optional GitHub repository context.",
    "  --base branch       Pull request base branch. Defaults to main.",
    "  --head branch       Pull request head branch. Defaults to the current branch.",
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
  const parsed = parseCliArgs(args);

  if (!parsed.ok) {
    stderr([parsed.message, "", formatUsage()].join("\n"));
    return 1;
  }

  if ("releasePath" in parsed.value) {
    return runReleasePullRequestCli(parsed.value, {
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

async function runReleasePullRequestCli(
  cliOptions: ReleasePullRequestCliOptions,
  dependencies: Required<
    Pick<RunCliOptions, "stdout" | "stderr" | "loadRelease" | "resolveCurrentBranch">
  > &
    Pick<RunCliOptions, "githubClient" | "createGitHubClient">
): Promise<number> {
  const release = await dependencies.loadRelease(cliOptions.releasePath);
  if (!release.ok) {
    dependencies.stderr(formatReleaseValidationErrors(release.errors));
    return 1;
  }

  const rendered = renderReleasePullRequestInput(release.value);
  const head = await resolvePullRequestHead(cliOptions, dependencies.resolveCurrentBranch);
  if (!head.ok) {
    dependencies.stderr(formatBranchResolutionFailure(head.message));
    return 1;
  }

  const input = toCreatePullRequestInput(cliOptions, rendered, head.branchName);

  if (cliOptions.dryRun) {
    dependencies.stdout(formatPullRequestDryRunOutput(input));
    return 0;
  }

  const client =
    dependencies.githubClient ??
    dependencies.createGitHubClient?.() ??
    new GhGitHubAutomationClient();
  const result = await client.createPullRequest(input);

  if (!result.ok) {
    dependencies.stderr(
      formatPullRequestCreationFailure(input.title, result.error.message)
    );
    return 1;
  }

  dependencies.stdout(formatPullRequestCreationSuccess(result.value));
  return 0;
}

function toCreatePullRequestInput(
  cliOptions: ReleasePullRequestCliOptions,
  rendered: { title: string; body: string },
  head: string
): CreatePullRequestInput {
  return {
    repository: cliOptions.repository,
    title: rendered.title,
    body: rendered.body,
    base: cliOptions.base,
    head
  };
}

async function resolvePullRequestHead(
  cliOptions: ReleasePullRequestCliOptions,
  resolveCurrentBranchFn: () => Promise<BranchResolutionResult>
): Promise<BranchResolutionResult> {
  if (cliOptions.head !== undefined) {
    return { ok: true, branchName: cliOptions.head };
  }

  return resolveCurrentBranchFn();
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

function formatPullRequestDryRunOutput(input: CreatePullRequestInput): string {
  const lines = [
    "Release pull request dry run:",
    `Repository: ${formatRepository(input.repository)}`,
    `Base: ${input.base}`,
    `Head: ${input.head}`,
    `Title: ${input.title}`,
    "",
    input.body ?? ""
  ];

  return lines.join("\n");
}

function formatReleaseValidationErrors(
  errors: readonly ReleaseValidationError[]
): string {
  return [
    "Release metadata validation failed:",
    ...errors.map((error) => `- ${error.message}`)
  ].join("\n");
}

function formatBranchResolutionFailure(message: string): string {
  return [
    "Current branch resolution failed:",
    message,
    "Provide --head explicitly."
  ].join("\n");
}

function formatPullRequestCreationSuccess(
  pullRequest: PullRequestDetails
): string {
  return [
    "Created GitHub pull request:",
    `- #${pullRequest.pullRequestNumber}: ${pullRequest.title} (${pullRequest.url})`
  ].join("\n");
}

function formatPullRequestCreationFailure(title: string, message: string): string {
  return [
    `GitHub pull request creation failed: ${title}`,
    message
  ].join("\n");
}

function formatRepository(repository: RepositorySelection | undefined): string {
  return repository ? `${repository.owner}/${repository.name}` : "(inferred by gh)";
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
