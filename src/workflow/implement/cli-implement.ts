#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  runImplementIssueWorkflow,
  type ImplementIssueWorkflowDependencies,
  type ImplementIssueWorkflowOptions,
  type ImplementIssueWorkflowResult
} from "./implement.js";

export type ImplementCliOptions = ImplementIssueWorkflowOptions;

export type ImplementCliParseResult =
  | {
      ok: true;
      value: ImplementCliOptions;
    }
  | {
      ok: false;
      message: string;
    };

export type ImplementWorkflowRunner = (
  options: ImplementIssueWorkflowOptions,
  dependencies?: ImplementIssueWorkflowDependencies
) => Promise<ImplementIssueWorkflowResult>;

export interface RunImplementCliOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  runImplementIssueWorkflow?: ImplementWorkflowRunner;
  workflowDependencies?: ImplementIssueWorkflowDependencies;
}

const valueFlags = new Set([
  "--issue",
  "--prompt",
  "--worktree",
  "--before-head",
  "--runs-dir"
]);

export function formatImplementUsage(): string {
  return [
    "Usage:",
    "  agent-workforce-implement --issue <number> --prompt <path> --worktree <path> --before-head <sha> [options]",
    "",
    "Options:",
    "  --issue <number>       GitHub issue number to implement.",
    "  --prompt <path>        Path to the prepared implement prompt.",
    "  --worktree <path>      Path to the prepared issue worktree.",
    "  --before-head <sha>    HEAD recorded before implementation.",
    "  --runs-dir <path>      Directory for implement run artifacts."
  ].join("\n");
}

export function parseImplementCliArgs(
  args: readonly string[]
): ImplementCliParseResult {
  let issueNumber: number | undefined;
  let promptPath: string | undefined;
  let targetWorktreePath: string | undefined;
  let beforeHead: string | undefined;
  let runsDirectory: string | undefined;
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

      if (arg === "--issue") {
        const parsed = parseIssueNumber(value);
        if (parsed === undefined) {
          return usageFailure("--issue must be a positive integer.");
        }
        issueNumber = parsed;
      } else if (arg === "--prompt") {
        promptPath = value;
      } else if (arg === "--worktree") {
        targetWorktreePath = value;
      } else if (arg === "--before-head") {
        beforeHead = value;
      } else {
        runsDirectory = value;
      }

      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      return usageFailure(`Unknown option: ${arg}.`);
    }

    return usageFailure(`Unexpected positional argument: ${arg}.`);
  }

  if (issueNumber === undefined) {
    return usageFailure("--issue is required.");
  }

  if (promptPath === undefined) {
    return usageFailure("--prompt is required.");
  }

  if (targetWorktreePath === undefined) {
    return usageFailure("--worktree is required.");
  }

  if (beforeHead === undefined) {
    return usageFailure("--before-head is required.");
  }

  return {
    ok: true,
    value: {
      issueNumber,
      promptPath,
      targetWorktreePath,
      beforeHead,
      ...(runsDirectory !== undefined ? { runsDirectory } : {})
    }
  };
}

export async function runImplementCli(
  args: readonly string[],
  options: RunImplementCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const parsed = parseImplementCliArgs(args);

  if (!parsed.ok) {
    stderr([parsed.message, "", formatImplementUsage()].join("\n"));
    return 1;
  }

  const runWorkflow =
    options.runImplementIssueWorkflow ?? runImplementIssueWorkflow;
  const result = await runWorkflow(parsed.value, options.workflowDependencies);

  if (!result.ok) {
    stderr(
      `Implement workflow failed at ${result.error.stage}: ${result.error.message}`
    );
    return 1;
  }

  stdout(formatImplementSuccess(result.value));
  return 0;
}

export function formatImplementSuccess(
  value: Extract<ImplementIssueWorkflowResult, { ok: true }>["value"]
): string {
  return [
    `Implemented issue #${value.verification.issueNumber}: ${value.release.pull_request.title}`,
    `Verification: ${value.verification.status}`,
    `Diff: ${value.artifacts.diffPath}`,
    `Verification output: ${value.artifacts.verificationOutputPath}`,
    `Release: ${value.artifacts.releasePath}`,
    `Run artifact: ${value.artifacts.runPath}`
  ].join("\n");
}

function parseIssueNumber(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function usageFailure(message: string): ImplementCliParseResult {
  return { ok: false, message };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runImplementCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
