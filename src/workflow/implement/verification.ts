import { spawn } from "node:child_process";

import type { GitAutomationClient } from "../../git/client.js";
import { LocalGitAutomationClient } from "../../git/git-client.js";
import type { GitAutomationResult } from "../../git/types.js";

export type ImplementVerificationStatus = "passed" | "failed";

export interface ImplementVerificationInput {
  issueNumber: number;
  targetWorktreePath: string;
  beforeHead: string;
  testCommand?: string;
}

export interface ImplementVerificationDependencies {
  gitClient?: GitAutomationClient;
  commandRunner?: ImplementVerificationCommandRunner;
  clock?: ImplementVerificationClock;
}

export interface ImplementVerificationCommandResult {
  command: string;
  exitCode: number;
  output: string;
}

export interface ImplementVerificationCommandRunner {
  run(input: ImplementVerificationCommandInput): Promise<ImplementVerificationCommandResult>;
}

export interface ImplementVerificationCommandInput {
  command: string;
  cwd: string;
}

export interface ImplementVerificationClock {
  now(): Date;
}

export interface ImplementVerificationCheckResult {
  name: string;
  status: ImplementVerificationStatus;
  passed: boolean;
  details: string;
}

export interface ImplementVerificationResult {
  issueNumber: number;
  targetWorktreePath: string;
  status: ImplementVerificationStatus;
  startedAt: string;
  finishedAt: string;
  beforeHead: string;
  afterHead?: string;
  changedFiles: string[];
  checks: ImplementVerificationCheckResult[];
  testCommand: ImplementVerificationCommandResult;
  report: string;
  error?: string;
}

const defaultTestCommand = "npm run test";

export async function runImplementVerification(
  input: ImplementVerificationInput,
  dependencies: ImplementVerificationDependencies = {}
): Promise<ImplementVerificationResult> {
  const gitClient = dependencies.gitClient ?? new LocalGitAutomationClient();
  const commandRunner =
    dependencies.commandRunner ?? new LocalImplementVerificationCommandRunner();
  const clock = dependencies.clock ?? systemClock;
  const startedAt = clock.now().toISOString();
  const command = input.testCommand ?? defaultTestCommand;

  const headResult = await getGitValue(
    () => gitClient.getHead({ targetWorktreePath: input.targetWorktreePath }),
    "Failed to get HEAD."
  );

  const changedFilesResult = await getGitValue(
    () => gitClient.getChangedFiles({ targetWorktreePath: input.targetWorktreePath }),
    "Failed to get changed files."
  );

  let commandResult: ImplementVerificationCommandResult;
  try {
    commandResult = await commandRunner.run({
      command,
      cwd: input.targetWorktreePath
    });
  } catch (cause) {
    commandResult = {
      command,
      exitCode: 1,
      output: formatUnknownError(cause)
    };
  }

  const afterHead = headResult.ok ? headResult.value.head : undefined;
  const changedFiles = changedFilesResult.ok ? changedFilesResult.value.files : [];
  const gitError = !headResult.ok
    ? headResult.error
    : !changedFilesResult.ok
      ? changedFilesResult.error
      : undefined;

  const checks: ImplementVerificationCheckResult[] = [
    {
      name: "HEAD unchanged",
      passed: afterHead !== undefined && input.beforeHead === afterHead,
      status:
        afterHead !== undefined && input.beforeHead === afterHead ? "passed" : "failed",
      details:
        afterHead === undefined
          ? "Unable to compare HEAD."
          : `Before HEAD: ${input.beforeHead}\nAfter HEAD: ${afterHead}`
    },
    {
      name: "Worktree has changes",
      passed: changedFiles.length > 0,
      status: changedFiles.length > 0 ? "passed" : "failed",
      details:
        changedFiles.length > 0
          ? `${changedFiles.length} changed file(s).`
          : changedFilesResult.ok
            ? "No changed files detected."
            : "Unable to retrieve changed files."
    },
    {
      name: "Test suite",
      passed: commandResult.exitCode === 0,
      status: commandResult.exitCode === 0 ? "passed" : "failed",
      details: `Exit code: ${commandResult.exitCode}`
    }
  ];

  const status: ImplementVerificationStatus = checks.every((check) => check.passed)
    ? "passed"
    : "failed";
  const finishedAt = clock.now().toISOString();

  const resultWithoutReport: Omit<ImplementVerificationResult, "report"> = {
    issueNumber: input.issueNumber,
    targetWorktreePath: input.targetWorktreePath,
    status,
    startedAt,
    finishedAt,
    beforeHead: input.beforeHead,
    ...(afterHead !== undefined ? { afterHead } : {}),
    changedFiles,
    checks,
    testCommand: commandResult,
    ...(gitError !== undefined ? { error: formatGitError(gitError) } : {})
  };

  return {
    ...resultWithoutReport,
    report: renderImplementVerificationReport(resultWithoutReport)
  };
}

export function renderImplementVerificationReport(
  result: Omit<ImplementVerificationResult, "report">
): string {
  const lines = [
    "Verification Report",
    `Issue: #${result.issueNumber}`,
    `Status: ${result.status}`,
    `Started At: ${result.startedAt}`,
    `Finished At: ${result.finishedAt}`,
    "",
    "Checks:"
  ];

  for (const check of result.checks) {
    lines.push(`[${check.status}] ${check.name}`, check.details);
  }

  lines.push("", "Changed Files:");
  if (result.changedFiles.length === 0) {
    lines.push("- None");
  } else {
    lines.push(...result.changedFiles.map((file) => `- ${file}`));
  }

  if (result.error !== undefined) {
    lines.push("", `Error: ${formatGitError(result.error)}`);
  }

  lines.push(
    "",
    `Command: ${result.testCommand.command}`,
    `Exit Code: ${result.testCommand.exitCode}`,
    "Raw Test Output:",
    result.testCommand.output
  );

  return lines.join("\n");
}

export class LocalImplementVerificationCommandRunner
  implements ImplementVerificationCommandRunner
{
  run(input: ImplementVerificationCommandInput): Promise<ImplementVerificationCommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, {
        cwd: input.cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let output = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        output += chunk;
      });

      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          command: input.command,
          exitCode: code ?? 1,
          output
        });
      });
    });
  }
}

async function getGitValue<T>(
  load: () => Promise<GitAutomationResult<T>>,
  fallbackMessage: string
): Promise<GitAutomationResult<T>> {
  try {
    return await load();
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "unknown",
        message: fallbackMessage,
        cause
      }
    };
  }
}

const systemClock: ImplementVerificationClock = {
  now: () => new Date()
};

function formatGitError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return formatUnknownError(error);
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
