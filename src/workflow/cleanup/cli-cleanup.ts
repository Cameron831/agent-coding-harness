#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  runCleanupIssueWorkspaceWorkflow,
  type CleanupIssueWorkspaceDependencies,
  type CleanupIssueWorkspaceOptions,
  type CleanupIssueWorkspaceResult
} from "./cleanup.js";

export interface CleanupCliOptions {
  issueNumber: number;
}

export type CleanupCliParseResult =
  | {
      ok: true;
      value: CleanupCliOptions;
    }
  | {
      ok: false;
      message: string;
    };

export type CleanupWorkflowRunner = (
  options: CleanupIssueWorkspaceOptions,
  dependencies?: CleanupIssueWorkspaceDependencies
) => Promise<CleanupIssueWorkspaceResult>;

export interface RunCleanupCliOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  runCleanupIssueWorkspaceWorkflow?: CleanupWorkflowRunner;
  workflowDependencies?: CleanupIssueWorkspaceDependencies;
}

const valueFlags = new Set(["--issue"]);

export function formatCleanupUsage(): string {
  return [
    "Usage:",
    "  agent-workforce cleanup --issue <number>",
    "",
    "Options:",
    "  --issue <number>       GitHub issue number to clean up.",
    "",
    "Defaults:",
    "  Uses .runs/issue-<number>/run.json.",
    "  .env in the current directory must provide TARGET_REPO_PATH."
  ].join("\n");
}

export function parseCleanupCliArgs(
  args: readonly string[]
): CleanupCliParseResult {
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
    value: { issueNumber }
  };
}

export async function runCleanupCli(
  args: readonly string[],
  options: RunCleanupCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const parsed = parseCleanupCliArgs(args);

  if (!parsed.ok) {
    stderr([parsed.message, "", formatCleanupUsage()].join("\n"));
    return 1;
  }

  const resolved = resolveCleanupWorkflowOptions(parsed.value.issueNumber);
  if (!resolved.ok) {
    stderr(resolved.message);
    return 1;
  }

  const runWorkflow =
    options.runCleanupIssueWorkspaceWorkflow ??
    runCleanupIssueWorkspaceWorkflow;
  const result = await runWorkflow(resolved.value, options.workflowDependencies);

  if (!result.ok) {
    stderr(formatCleanupFailure(result.error));
    return 1;
  }

  stdout(formatCleanupSuccess(result.value));
  return 0;
}

export function formatCleanupSuccess(
  value: Extract<CleanupIssueWorkspaceResult, { ok: true }>["value"]
): string {
  const issueText =
    value.issueNumber !== undefined ? ` issue #${value.issueNumber}` : "";

  return [
    `Cleaned up${issueText}.`,
    `Worktree removed: ${value.worktree.targetWorktreePath}`,
    value.branch.deleted
      ? `Branch deleted: ${value.branch.branchName}`
      : `Branch already absent: ${value.branch.branchName}`,
    `Run artifact: ${value.runPath}`
  ].join("\n");
}

function formatCleanupFailure(
  error: Extract<CleanupIssueWorkspaceResult, { ok: false }>["error"]
): string {
  const lines = [
    `Cleanup workflow failed at ${error.stage}: ${error.message}`
  ];

  if (error.worktreeCleanup !== undefined) {
    lines.push(
      `Worktree removed before branch failure: ${error.worktreeCleanup.targetWorktreePath}`
    );
  }

  return lines.join("\n");
}

function resolveCleanupWorkflowOptions(
  issueNumber: number
): CleanupCliRuntimeResult<CleanupIssueWorkspaceOptions> {
  const runPath = `.runs/issue-${issueNumber}/run.json`;
  const env = loadCleanupEnvDefaults();
  if (!env.ok) {
    return env;
  }

  const run = loadCleanupRunDefaults(runPath);
  if (!run.ok) {
    return run;
  }

  return {
    ok: true,
    value: {
      issueNumber,
      runPath,
      targetRepositoryPath: env.value.targetRepositoryPath,
      targetWorktreePath: run.value.targetWorktreePath,
      branch: run.value.branch
    }
  };
}

interface CleanupEnvDefaults {
  targetRepositoryPath: string;
}

interface CleanupRunDefaults {
  targetWorktreePath: string;
  branch: string;
}

type CleanupCliRuntimeResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      message: string;
    };

function loadCleanupEnvDefaults(): CleanupCliRuntimeResult<CleanupEnvDefaults> {
  let contents: string;
  try {
    contents = readFileSync(".env", "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return runtimeFailure("Missing .env in the current working directory.");
    }
    return runtimeFailure(
      `Failed to read .env: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const values = parseCleanupEnv(contents);
  const targetRepositoryPath = values.TARGET_REPO_PATH;
  if (targetRepositoryPath === undefined) {
    return runtimeFailure("TARGET_REPO_PATH is required in .env.");
  }

  return {
    ok: true,
    value: { targetRepositoryPath }
  };
}

function parseCleanupEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmedStart = line.trimStart();
    if (trimmedStart === "" || trimmedStart.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    if (key === "" || value.trim() === "") {
      continue;
    }

    values[key] = value;
  }

  return values;
}

function loadCleanupRunDefaults(
  runPath: string
): CleanupCliRuntimeResult<CleanupRunDefaults> {
  let contents: string;
  try {
    contents = readFileSync(runPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return runtimeFailure(`Missing run artifact: ${runPath}.`);
    }
    return runtimeFailure(
      `Failed to read run artifact ${runPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return runtimeFailure(`Run artifact ${runPath} must be valid JSON.`);
  }

  if (!isRecord(parsed)) {
    return runtimeFailure(`Run artifact ${runPath} must be a JSON object.`);
  }

  const worktreePath = parsed.worktreePath;
  if (typeof worktreePath !== "string" || worktreePath.trim() === "") {
    return runtimeFailure(`Run artifact ${runPath} missing worktreePath.`);
  }

  const branch = parsed.branch;
  if (typeof branch !== "string" || branch.trim() === "") {
    return runtimeFailure(`Run artifact ${runPath} missing branch.`);
  }

  return {
    ok: true,
    value: {
      targetWorktreePath: worktreePath,
      branch
    }
  };
}

function parseIssueNumber(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usageFailure(message: string): CleanupCliParseResult {
  return { ok: false, message };
}

function runtimeFailure<T>(message: string): CleanupCliRuntimeResult<T> {
  return { ok: false, message };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCleanupCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
