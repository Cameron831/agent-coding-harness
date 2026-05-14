#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { RepositorySelection } from "../../github/types.js";
import {
  runReleasePublishWorkflow,
  type ReleasePublishWorkflowDependencies,
  type ReleasePublishWorkflowOptions,
  type ReleasePublishWorkflowResult
} from "./publish.js";

export interface ReleaseCliOptions {
  issueNumber: number;
}

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

const valueFlags = new Set(["--issue"]);

export function formatReleaseUsage(): string {
  return [
    "Usage:",
    "  agent-workforce-release --issue <number>",
    "",
    "Options:",
    "  --issue <number>       GitHub issue number to release.",
    "",
    "Defaults:",
    "  Uses .runs/issue-<number>/release.json and .runs/issue-<number>/run.json.",
    "  .env in the current directory must provide TARGET_REPO_PATH, REPO_SLUG, and BASE_REF."
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

  const resolved = resolveReleaseWorkflowOptions(parsed.value.issueNumber);
  if (!resolved.ok) {
    stderr(resolved.message);
    return 1;
  }

  const runWorkflow =
    options.runReleasePublishWorkflow ?? runReleasePublishWorkflow;
  const result = await runWorkflow(resolved.value, options.workflowDependencies);

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

function resolveReleaseWorkflowOptions(
  issueNumber: number
): ReleaseCliRuntimeResult<ReleasePublishWorkflowOptions> {
  const runDirectory = `.runs/issue-${issueNumber}`;
  const releasePath = `${runDirectory}/release.json`;
  const runPath = `${runDirectory}/run.json`;
  const env = loadReleaseEnvDefaults();
  if (!env.ok) {
    return env;
  }

  const run = loadReleaseRunDefaults(runPath);
  if (!run.ok) {
    return run;
  }

  let repository: RepositorySelection;
  try {
    repository = parseReleaseRepository(env.value.repository);
  } catch (error) {
    return runtimeFailure(
      `Invalid REPO_SLUG in .env: ${
        error instanceof Error
          ? error.message
          : "Repository must use exact owner/name format."
      }`
    );
  }

  return {
    ok: true,
    value: {
      issueNumber,
      releasePath,
      runPath,
      targetRepositoryPath: env.value.targetRepositoryPath,
      targetWorktreePath: run.value.targetWorktreePath,
      branch: run.value.branch,
      base: env.value.base,
      repository
    }
  };
}

interface ReleaseEnvDefaults {
  targetRepositoryPath: string;
  repository: string;
  base: string;
}

interface ReleaseRunDefaults {
  targetWorktreePath: string;
  branch: string;
}

type ReleaseCliRuntimeResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      message: string;
    };

function loadReleaseEnvDefaults(): ReleaseCliRuntimeResult<ReleaseEnvDefaults> {
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

  const values = parseReleaseEnv(contents);
  const targetRepositoryPath = values.TARGET_REPO_PATH;
  if (targetRepositoryPath === undefined) {
    return runtimeFailure("TARGET_REPO_PATH is required in .env.");
  }

  const repository = values.REPO_SLUG;
  if (repository === undefined) {
    return runtimeFailure("REPO_SLUG is required in .env.");
  }

  const base = values.BASE_REF;
  if (base === undefined) {
    return runtimeFailure("BASE_REF is required in .env.");
  }

  return {
    ok: true,
    value: {
      targetRepositoryPath,
      repository,
      base
    }
  };
}

function parseReleaseEnv(contents: string): Record<string, string> {
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

function loadReleaseRunDefaults(
  runPath: string
): ReleaseCliRuntimeResult<ReleaseRunDefaults> {
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

function usageFailure(message: string): ReleaseCliParseResult {
  return { ok: false, message };
}

function runtimeFailure<T>(message: string): ReleaseCliRuntimeResult<T> {
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
