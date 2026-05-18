#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RepositorySelection } from "../../github/types.js";
import {
  runPrepareWorkflow,
  type PrepareWorkflowDependencies,
  type PrepareWorkflowOptions,
  type PrepareWorkflowResult
} from "./prepare.js";
import type { ImplementPromptVariant } from "../prompt-builder.js";
import {
  invalidPrepareBaseRefMessage,
  parsePrepareBaseRef
} from "./base-ref.js";

export type PrepareCliOptions = PrepareWorkflowOptions;

export type PrepareCliParseResult =
  | {
      ok: true;
      value: PrepareCliOptions;
    }
  | {
      ok: false;
      message: string;
    };

export type PrepareWorkflowRunner = (
  options: PrepareWorkflowOptions,
  dependencies?: PrepareWorkflowDependencies
) => Promise<PrepareWorkflowResult>;

export interface RunPrepareCliOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  runPrepareWorkflow?: PrepareWorkflowRunner;
  workflowDependencies?: PrepareWorkflowDependencies;
}

const promptVariants: readonly ImplementPromptVariant[] = [
  "standard",
  "with-subagents"
];

const valueFlags = new Set([
  "--issue",
  "--target-repo",
  "--worktree-parent",
  "--repo",
  "--base-ref",
  "--prompt-variant",
  "--prompts-dir",
  "--runs-dir"
]);

export function formatPrepareUsage(): string {
  return [
    "Usage:",
    "  agent-workforce-prepare --issue <number> [--target-repo <path>] [--worktree-parent <path>] [options]",
    "",
    "Options:",
    "  --issue <number>             GitHub issue number to prepare.",
    "  --target-repo <path>         Path to the target repository.",
    "  --worktree-parent <path>     Directory where the issue worktree is created.",
    "  --repo owner/name            Optional GitHub repository context.",
    "  --base-ref <ref>             Base ref for the prepared worktree.",
    "  --prompt-variant <variant>   Prompt variant: standard or with-subagents.",
    "  --prompts-dir <path>         Directory containing prepare prompt templates.",
    "  --runs-dir <path>            Directory for prepare run artifacts.",
    "",
    "Defaults:",
    "  .env in the current directory may provide TARGET_REPO_PATH, WORKTREE_PARENT_PATH, and REPO_SLUG."
  ].join("\n");
}

export function parsePrepareRepository(value: string): RepositorySelection {
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

export function parsePrepareCliArgs(
  args: readonly string[]
): PrepareCliParseResult {
  let issueNumber: number | undefined;
  let targetRepositoryPath: string | undefined;
  let worktreeParentPath: string | undefined;
  let repository: RepositorySelection | undefined;
  let baseRef: string | undefined;
  let promptVariant: ImplementPromptVariant | undefined;
  let promptsDirectory: string | undefined;
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
      } else if (arg === "--target-repo") {
        targetRepositoryPath = value;
      } else if (arg === "--worktree-parent") {
        worktreeParentPath = value;
      } else if (arg === "--repo") {
        try {
          repository = parsePrepareRepository(value);
        } catch (error) {
          return usageFailure(
            error instanceof Error
              ? error.message
              : "Repository must use exact owner/name format."
          );
        }
      } else if (arg === "--base-ref") {
        if (parsePrepareBaseRef(value) === undefined) {
          return usageFailure(`--base-ref ${invalidPrepareBaseRefMessage}`);
        }
        baseRef = value;
      } else if (arg === "--prompt-variant") {
        if (!isPromptVariant(value)) {
          return usageFailure(
            `--prompt-variant must be one of: ${promptVariants.join(", ")}.`
          );
        }
        promptVariant = value;
      } else if (arg === "--prompts-dir") {
        promptsDirectory = value;
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

  const envDefaults = loadPrepareEnvDefaults();
  targetRepositoryPath ??= envDefaults.targetRepositoryPath;
  worktreeParentPath ??= envDefaults.worktreeParentPath;

  if (repository === undefined && envDefaults.repository !== undefined) {
    try {
      repository = parsePrepareRepository(envDefaults.repository);
    } catch (error) {
      return usageFailure(
        error instanceof Error
          ? error.message
          : "Repository must use exact owner/name format."
      );
    }
  }

  if (targetRepositoryPath === undefined) {
    return usageFailure("--target-repo is required.");
  }

  if (worktreeParentPath === undefined) {
    return usageFailure("--worktree-parent is required.");
  }

  return {
    ok: true,
    value: {
      issueNumber,
      targetRepositoryPath,
      worktreeParentPath,
      ...(repository !== undefined ? { repository } : {}),
      ...(baseRef !== undefined ? { baseRef } : {}),
      ...(promptVariant !== undefined ? { promptVariant } : {}),
      ...(promptsDirectory !== undefined ? { promptsDirectory } : {}),
      ...(runsDirectory !== undefined ? { runsDirectory } : {})
    }
  };
}

export async function runPrepareCli(
  args: readonly string[],
  options: RunPrepareCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const parsed = parsePrepareCliArgs(args);

  if (!parsed.ok) {
    stderr([parsed.message, "", formatPrepareUsage()].join("\n"));
    return 1;
  }

  const runWorkflow = options.runPrepareWorkflow ?? runPrepareWorkflow;
  const result = await runWorkflow(parsed.value, options.workflowDependencies);

  if (!result.ok) {
    stderr(
      `Prepare workflow failed at ${result.error.stage}: ${result.error.message}`
    );
    return 1;
  }

  stdout(formatPrepareSuccess(result.value));
  return 0;
}

export function formatPrepareSuccess(
  value: Extract<PrepareWorkflowResult, { ok: true }>["value"]
): string {
  return [
    `Prepared issue #${value.issue.issueNumber}: ${value.issue.title}`,
    `Branch: ${value.branch}`,
    `Worktree: ${value.worktreePath}`,
    `Prompt: ${value.promptPath}`,
    `Issue artifact: ${value.issuePath}`,
    `Run artifact: ${value.runPath}`
  ].join("\n");
}

function parseIssueNumber(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isPromptVariant(value: string): value is ImplementPromptVariant {
  return promptVariants.includes(value as ImplementPromptVariant);
}

interface PrepareEnvDefaults {
  targetRepositoryPath?: string;
  worktreeParentPath?: string;
  repository?: string;
}

function loadPrepareEnvDefaults(): PrepareEnvDefaults {
  let contents: string;
  try {
    contents = readFileSync(join(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  const values = parsePrepareEnv(contents);
  return {
    ...(values.TARGET_REPO_PATH !== undefined
      ? { targetRepositoryPath: values.TARGET_REPO_PATH }
      : {}),
    ...(values.WORKTREE_PARENT_PATH !== undefined
      ? { worktreeParentPath: values.WORKTREE_PARENT_PATH }
      : {}),
    ...(values.REPO_SLUG !== undefined ? { repository: values.REPO_SLUG } : {})
  };
}

function parsePrepareEnv(contents: string): Record<string, string> {
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

function usageFailure(message: string): PrepareCliParseResult {
  return { ok: false, message };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runPrepareCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
