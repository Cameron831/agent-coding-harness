#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import type { RepositorySelection } from "../../github/types.js";
import {
  runReleasePublishWorkflow,
  type ReleasePublishWorkflowDependencies,
  type ReleasePublishWorkflowOptions,
  type ReleasePublishWorkflowResult
} from "./publish.js";

export type ReleaseCliOptions = ReleasePublishWorkflowOptions;

export type ReleaseCliParseResult =
  | {
      ok: true;
      value: ReleaseCliOptions;
    }
  | {
      ok: false;
      message: string;
    };

export type ReleaseWorkflowRunner = (
  options: ReleasePublishWorkflowOptions,
  dependencies?: ReleasePublishWorkflowDependencies
) => Promise<ReleasePublishWorkflowResult>;

export interface RunReleaseCliOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  runReleasePublishWorkflow?: ReleaseWorkflowRunner;
  workflowDependencies?: ReleasePublishWorkflowDependencies;
}

const valueFlags = new Set([
  "--release",
  "--target-repo",
  "--worktree",
  "--branch",
  "--base",
  "--run",
  "--repo"
]);

export function formatReleaseUsage(): string {
  return [
    "Usage:",
    "  agent-workforce-release --release <path> --target-repo <path> --worktree <path> --branch <name> --base <ref> [options]",
    "",
    "Options:",
    "  --release <path>       Path to the approved release metadata JSON.",
    "  --target-repo <path>   Path to the target repository.",
    "  --worktree <path>      Path to the implemented issue worktree.",
    "  --branch <name>        Branch to push and use as the PR head.",
    "  --base <ref>           Base branch or ref for the pull request.",
    "  --run <path>           Optional run artifact path.",
    "  --repo owner/name      Optional GitHub repository context."
  ].join("\n");
}

export function parseReleaseRepository(value: string): RepositorySelection {
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

export function parseReleaseCliArgs(
  args: readonly string[]
): ReleaseCliParseResult {
  let releasePath: string | undefined;
  let targetRepositoryPath: string | undefined;
  let targetWorktreePath: string | undefined;
  let branch: string | undefined;
  let base: string | undefined;
  let runPath: string | undefined;
  let repository: RepositorySelection | undefined;
  const seenFlags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (valueFlags.has(arg)) {
      if (seenFlags.has(arg)) {
        return usageFailure(`${arg} may only be provided once.`);
      }
      seenFlags.add(arg);

      const value = args[index + 1];
      if (value === undefined || value.startsWith("--") || value === "") {
        return usageFailure(`${arg} requires a value.`);
      }

      if (arg === "--release") {
        releasePath = value;
      } else if (arg === "--target-repo") {
        targetRepositoryPath = value;
      } else if (arg === "--worktree") {
        targetWorktreePath = value;
      } else if (arg === "--branch") {
        branch = value;
      } else if (arg === "--base") {
        base = value;
      } else if (arg === "--run") {
        runPath = value;
      } else {
        try {
          repository = parseReleaseRepository(value);
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

  if (releasePath === undefined) {
    return usageFailure("--release is required.");
  }

  if (targetRepositoryPath === undefined) {
    return usageFailure("--target-repo is required.");
  }

  if (targetWorktreePath === undefined) {
    return usageFailure("--worktree is required.");
  }

  if (branch === undefined) {
    return usageFailure("--branch is required.");
  }

  if (base === undefined) {
    return usageFailure("--base is required.");
  }

  return {
    ok: true,
    value: {
      releasePath,
      targetRepositoryPath,
      targetWorktreePath,
      branch,
      base,
      ...(runPath !== undefined ? { runPath } : {}),
      ...(repository !== undefined ? { repository } : {})
    }
  };
}

export async function runReleaseCli(
  args: readonly string[],
  options: RunReleaseCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const parsed = parseReleaseCliArgs(args);

  if (!parsed.ok) {
    stderr([parsed.message, "", formatReleaseUsage()].join("\n"));
    return 1;
  }

  const runWorkflow =
    options.runReleasePublishWorkflow ?? runReleasePublishWorkflow;
  const result = await runWorkflow(parsed.value, options.workflowDependencies);

  if (!result.ok) {
    stderr(formatReleaseFailure(result.error));
    return 1;
  }

  stdout(formatReleaseSuccess(result.value));
  return 0;
}

export function formatReleaseSuccess(
  value: Extract<ReleasePublishWorkflowResult, { ok: true }>["value"]
): string {
  return [
    "Published release.",
    `Release: ${value.releasePath}`,
    `Run artifact: ${value.runPath}`,
    `Branch: ${value.push.branchName}`,
    `Worktree: ${value.commit.targetWorktreePath}`,
    `Commit: ${value.commit.commitSha}`,
    `Pushed: ${value.push.remoteName}/${value.push.branchName}`,
    `Pull request: #${value.pullRequest.pullRequestNumber} ${value.pullRequest.url}`,
    `Cleanup: ${value.cleanup.removed ? "removed" : "not removed"}`
  ].join("\n");
}

function formatReleaseFailure(
  error: Extract<ReleasePublishWorkflowResult, { ok: false }>["error"]
): string {
  const lines = [
    `Release workflow failed at ${error.stage}: ${error.message}`
  ];

  for (const validationError of error.errors ?? []) {
    lines.push(validationError.message);
  }

  return lines.join("\n");
}

function usageFailure(message: string): ReleaseCliParseResult {
  return { ok: false, message };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runReleaseCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
