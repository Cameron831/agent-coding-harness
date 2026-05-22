import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { LocalGitAutomationClient } from "../src/git/git-client.js";

export type EvalGradeStatus = "pass" | "fail";
export type EvalGradeCheckName =
  | "non-empty-diff"
  | "allowed-changed-files"
  | "tests";

export interface EvalGradeCaseMetadata {
  id: string;
  testCommand: string;
  allowedChangedFiles: string[];
}

export interface EvalGradeInput {
  caseID: string;
  runID: string;
  startedAt: string;
  case: EvalGradeCaseMetadata;
  release: unknown;
  promptPath: string;
  tempPath: string;
  outputsPath: string;
}

export interface EvalGradeDependencies {
  gitClient?: EvalGradeGitReader;
  commandRunner?: EvalGradeCommandRunner;
  clock?: EvalGradeClock;
}

export interface EvalGradeGitInput {
  targetWorktreePath: string;
}

export type EvalGradeGitDiffResult =
  | {
      ok: true;
      value: {
        diff: string;
      };
    }
  | {
      ok: false;
      error: unknown;
    };

export type EvalGradeGitChangedFilesResult =
  | {
      ok: true;
      value: {
        files: string[];
      };
    }
  | {
      ok: false;
      error: unknown;
    };

export interface EvalGradeGitReader {
  getDiff(input: EvalGradeGitInput): Promise<EvalGradeGitDiffResult>;
  getChangedFiles(
    input: EvalGradeGitInput
  ): Promise<EvalGradeGitChangedFilesResult>;
}

export interface EvalGradeCommandInput {
  command: string;
  cwd: string;
}

export interface EvalGradeCommandResult {
  command: string;
  exitCode: number;
  output: string;
}

export interface EvalGradeCommandRunner {
  run(input: EvalGradeCommandInput): Promise<EvalGradeCommandResult>;
}

export interface EvalGradeClock {
  now(): Date;
}

export interface EvalGradeCheckResult {
  name: EvalGradeCheckName;
  status: EvalGradeStatus;
}

export interface EvalGradeFileChanges {
  changedFiles: string[];
  disallowedChangedFiles: string[];
}

export interface EvalGradeReport {
  caseId: string;
  runId: string;
  status: EvalGradeStatus;
  startedAt: string;
  finishedAt: string;
  checks: EvalGradeCheckResult[];
  changedFiles: string[];
  testCommand: string;
  allowedChangedFiles: string[];
}

export interface EvalGradeResult {
  status: EvalGradeStatus;
  report: EvalGradeReport;
}

export async function gradeEvalRun(
  input: EvalGradeInput,
  dependencies: EvalGradeDependencies = {}
): Promise<EvalGradeResult> {
  const gitClient = dependencies.gitClient ?? new LocalGitAutomationClient();
  const commandRunner =
    dependencies.commandRunner ?? new LocalEvalGradeCommandRunner();
  const clock = dependencies.clock ?? systemClock;
  const command = `npm ci && ${input.case.testCommand}`;

  await ensureOutputDirectory(input.outputsPath);
  await writeTextArtifact(
    join(input.outputsPath, "release.json"),
    formatJson(input.release, "release JSON value"),
    "release artifact"
  );
  await copyPromptArtifact(input.promptPath, join(input.outputsPath, "prompt.md"));

  const diff = await readDiff(gitClient, input.tempPath);
  await writeTextArtifact(join(input.outputsPath, "diff.patch"), diff, "diff artifact");

  const changedFiles = await readChangedFiles(gitClient, input.tempPath);
  const fileChanges = buildFileChanges(
    changedFiles,
    input.case.allowedChangedFiles
  );
  await writeTextArtifact(
    join(input.outputsPath, "files-changes.json"),
    formatJson(fileChanges, "file changes artifact"),
    "file changes artifact"
  );

  const testCommand = await runTestCommand(commandRunner, {
    command,
    cwd: input.tempPath
  });
  await writeTextArtifact(
    join(input.outputsPath, "test-output.txt"),
    formatTestOutput(testCommand),
    "test output artifact"
  );

  const checks = buildChecks(diff, fileChanges, testCommand);
  const status: EvalGradeStatus = checks.every((check) => check.status === "pass")
    ? "pass"
    : "fail";
  const report: EvalGradeReport = {
    caseId: input.caseID,
    runId: input.runID,
    status,
    startedAt: input.startedAt,
    finishedAt: clock.now().toISOString(),
    checks,
    changedFiles: fileChanges.changedFiles,
    testCommand: input.case.testCommand,
    allowedChangedFiles: input.case.allowedChangedFiles
  };

  await writeTextArtifact(
    join(input.outputsPath, "report.json"),
    formatJson(report, "grade report"),
    "grade report"
  );

  return {
    status,
    report,
  };
}

export class LocalEvalGradeCommandRunner implements EvalGradeCommandRunner {
  run(input: EvalGradeCommandInput): Promise<EvalGradeCommandResult> {
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

async function ensureOutputDirectory(outputsPath: string): Promise<void> {
  try {
    await mkdir(outputsPath, { recursive: true });
  } catch (cause) {
    throw new Error(
      `Unable to create outputs directory at ${outputsPath}: ${messageFromUnknown(cause)}`
    );
  }
}

async function copyPromptArtifact(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await copyFile(sourcePath, targetPath);
  } catch (cause) {
    throw new Error(
      `Unable to copy prompt artifact from ${sourcePath} to ${targetPath}: ${messageFromUnknown(cause)}`
    );
  }
}

async function writeTextArtifact(
  path: string,
  contents: string,
  label: string
): Promise<void> {
  try {
    await writeFile(path, contents, "utf8");
  } catch (cause) {
    throw new Error(
      `Unable to write ${label} at ${path}: ${messageFromUnknown(cause)}`
    );
  }
}

async function readDiff(
  gitClient: EvalGradeGitReader,
  tempPath: string
): Promise<string> {
  const result = await gitClient.getDiff({ targetWorktreePath: tempPath });
  if (!result.ok) {
    throw new Error(
      `Unable to read diff from ${tempPath}: ${messageFromUnknown(result.error)}`
    );
  }

  return result.value.diff;
}

async function readChangedFiles(
  gitClient: EvalGradeGitReader,
  tempPath: string
): Promise<string[]> {
  const result = await gitClient.getChangedFiles({
    targetWorktreePath: tempPath
  });
  if (!result.ok) {
    throw new Error(
      `Unable to read changed files from ${tempPath}: ${messageFromUnknown(result.error)}`
    );
  }

  return result.value.files.map(normalizePathSeparators);
}

async function runTestCommand(
  commandRunner: EvalGradeCommandRunner,
  input: EvalGradeCommandInput
): Promise<EvalGradeCommandResult> {
  try {
    const result = await commandRunner.run(input);
    return {
      command: input.command,
      exitCode: result.exitCode,
      output: result.output
    };
  } catch (cause) {
    throw new Error(
      `Unable to run test command in ${input.cwd}: ${messageFromUnknown(cause)}`
    );
  }
}

function buildFileChanges(
  changedFiles: string[],
  allowedChangedFiles: string[]
): EvalGradeFileChanges {
  const allowed = new Set(allowedChangedFiles.map(normalizePathSeparators));
  const disallowedChangedFiles = changedFiles.filter((file) => !allowed.has(file));

  return {
    changedFiles,
    disallowedChangedFiles
  };
}

function buildChecks(
  diff: string,
  fileChanges: EvalGradeFileChanges,
  testCommand: EvalGradeCommandResult
): EvalGradeCheckResult[] {
  return [
    {
      name: "non-empty-diff",
      status: diff.trim() === "" ? "fail" : "pass"
    },
    {
      name: "allowed-changed-files",
      status:
        fileChanges.disallowedChangedFiles.length === 0 ? "pass" : "fail"
    },
    {
      name: "tests",
      status: testCommand.exitCode === 0 ? "pass" : "fail"
    }
  ];
}

function formatJson(value: unknown, label: string): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value, null, 2);
  } catch (cause) {
    throw new Error(
      `Unable to serialize ${label}: ${messageFromUnknown(cause)}`
    );
  }

  if (json === undefined) {
    throw new Error(`${label} must be JSON-serializable.`);
  }

  return `${json}\n`;
}

function formatTestOutput(result: EvalGradeCommandResult): string {
  return [
    `Command: ${result.command}`,
    `Exit Code: ${result.exitCode}`,
    "Raw Output:",
    result.output
  ].join("\n");
}

function normalizePathSeparators(pathValue: string): string {
  return pathValue.replaceAll("\\", "/");
}

const systemClock: EvalGradeClock = {
  now: () => new Date()
};

function messageFromUnknown(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return value.message;
  }

  return value instanceof Error ? value.message : String(value);
}
