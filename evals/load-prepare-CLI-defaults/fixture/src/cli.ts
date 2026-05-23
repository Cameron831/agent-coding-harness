#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { runPrepareCli as runPrepareWorkflowLocalCli } from "./workflow/prepare/cli-prepare.js";

export type WorkflowLocalCliRunner = (
  args: readonly string[],
  options?: {
    stdout?: (message: string) => void;
    stderr?: (message: string) => void;
  }
) => Promise<number>;

export interface RunCliOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  runPrepareCli?: WorkflowLocalCliRunner;
}

export function formatUsage(): string {
  return [
    "Usage:",
    "  agent-workforce prepare [prepare options]",
    "",
    "Commands:",
    "  prepare            Run the staged prepare workflow."
  ].join("\n");
}

export async function runCli(
  args: readonly string[],
  options: RunCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const [command, ...commandArgs] = args;

  if (command === "prepare") {
    return (options.runPrepareCli ?? runPrepareWorkflowLocalCli)(commandArgs, {
      stdout,
      stderr
    });
  }

  const message =
    command === undefined ? "A command is required." : `Unknown command: ${command}.`;
  stderr([message, "", formatUsage()].join("\n"));
  return 1;
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
