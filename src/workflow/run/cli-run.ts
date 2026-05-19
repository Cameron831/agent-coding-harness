#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { runImplementCli as runImplementWorkflowLocalCli } from "../implement/cli-implement.js";
import { runPrepareCli as runPrepareWorkflowLocalCli } from "../prepare/cli-prepare.js";
import { runReleaseCli as runReleaseWorkflowLocalCli } from "../release/cli-release.js";

export interface RunWorkflowCliOptions {
  issueNumber: number;
}

export type RunWorkflowCliParseResult =
  | {
      ok: true;
      value: RunWorkflowCliOptions;
    }
  | {
      ok: false;
      message: string;
    };

export type RunStageCliRunner = (
  args: readonly string[],
  options?: {
    stdout?: (message: string) => void;
    stderr?: (message: string) => void;
  }
) => Promise<number>;

export interface RunRunCliOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  runPrepareCli?: RunStageCliRunner;
  runImplementCli?: RunStageCliRunner;
  runReleaseCli?: RunStageCliRunner;
}

const valueFlags = new Set(["--issue"]);

export function formatRunUsage(): string {
  return [
    "Usage:",
    "  agent-workforce run --issue <number>",
    "",
    "Options:",
    "  --issue <number>       GitHub issue number to prepare, implement, and release.",
    "",
    "This command publishes the release after successful implementation."
  ].join("\n");
}

export function parseRunCliArgs(
  args: readonly string[]
): RunWorkflowCliParseResult {
  let issueNumber: number | undefined;
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

      const parsed = parseIssueNumber(value);
      if (parsed === undefined) {
        return usageFailure("--issue must be a positive integer.");
      }
      issueNumber = parsed;

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

  return {
    ok: true,
    value: {
      issueNumber
    }
  };
}

export async function runRunCli(
  args: readonly string[],
  options: RunRunCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const parsed = parseRunCliArgs(args);

  if (!parsed.ok) {
    stderr([parsed.message, "", formatRunUsage()].join("\n"));
    return 1;
  }

  const issueArgs = ["--issue", String(parsed.value.issueNumber)];
  const stageOptions = { stdout, stderr };
  const prepareExitCode = await (
    options.runPrepareCli ?? runPrepareWorkflowLocalCli
  )(issueArgs, stageOptions);
  if (prepareExitCode !== 0) {
    return prepareExitCode;
  }

  const implementExitCode = await (
    options.runImplementCli ?? runImplementWorkflowLocalCli
  )(issueArgs, stageOptions);
  if (implementExitCode !== 0) {
    return implementExitCode;
  }

  const releaseExitCode = await (
    options.runReleaseCli ?? runReleaseWorkflowLocalCli
  )(issueArgs, stageOptions);
  if (releaseExitCode !== 0) {
    return releaseExitCode;
  }

  stdout(formatRunSuccess(parsed.value.issueNumber));
  return 0;
}

export function formatRunSuccess(issueNumber: number): string {
  return `Completed prepare, implement, and release for issue #${issueNumber}.`;
}

function parseIssueNumber(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function usageFailure(message: string): RunWorkflowCliParseResult {
  return { ok: false, message };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runRunCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
