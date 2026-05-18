import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IssueDetails } from "../../github/types.js";

export type PrepareRunStatus =
  | "preparing"
  | "prepared"
  | "implementing"
  | "needsFeedback"
  | "approvedPublishing"
  | "publishing"
  | "published";

export interface PrepareIssueArtifact {
  number: number;
  title: string;
  body: string;
}

export type PrepareRunArtifact = Record<string, unknown> & {
  status: PrepareRunStatus;
  issueURL?: string;
  issueTitle?: string;
  issueNumber?: number;
  worktreePath?: string;
  branch?: string;
  beforeHead?: string;
};

export interface WriteIssueArtifactInput {
  issue: IssueDetails;
  runsDirectory?: string;
}

export interface WriteIssueArtifactResult {
  runDirectory: string;
  issuePath: string;
  issue: PrepareIssueArtifact;
}

export interface WritePromptArtifactInput {
  issueNumber: number;
  /**
   * Written exactly as supplied, without newline normalization or trailing
   * newline insertion.
   */
  prompt: string;
  runsDirectory?: string;
}

export interface WritePromptArtifactResult {
  runDirectory: string;
  promptPath: string;
}

export interface WriteRunArtifactInput {
  issueNumber: number;
  runsDirectory?: string;
}

export interface WriteRunArtifactResult {
  runDirectory: string;
  runPath: string;
  run: PrepareRunArtifact;
}

export interface UpdateRunArtifactInput {
  issueNumber: number;
  runsDirectory?: string;
  issue?: IssueDetails;
  worktreePath?: string;
  branchName?: string;
  beforeHead?: string;
  status?: PrepareRunStatus;
}

export type UpdateRunArtifactResult = WriteRunArtifactResult;

export interface PrepareArtifactWriterResult {
  runDirectory: string;
  promptPath: string;
  issuePath: string;
  runPath: string;
  issue: PrepareIssueArtifact;
  run: PrepareRunArtifact;
}

export interface PrepareArtifactPaths {
  runDirectory: string;
  promptPath: string;
  issuePath: string;
  runPath: string;
}

export interface LoadPrepareRunStateInput {
  issueNumber: number;
  runsDirectory?: string;
}

export interface LoadPrepareRunStateResult {
  paths: PrepareArtifactPaths;
  run?: PrepareRunArtifact;
}

export async function loadPrepareRunState(
  input: LoadPrepareRunStateInput
): Promise<LoadPrepareRunStateResult> {
  const paths = prepareArtifactPaths(input.issueNumber, input.runsDirectory);
  const run = await loadExistingRunArtifactIfPresent(paths.runPath);

  return {
    paths,
    ...(run !== undefined ? { run: run as PrepareRunArtifact } : {})
  };
}

export async function writeIssueArtifact(
  input: WriteIssueArtifactInput
): Promise<WriteIssueArtifactResult> {
  const paths = prepareArtifactPaths(
    input.issue.issueNumber,
    input.runsDirectory
  );
  const issue = buildIssueArtifact(input.issue);

  await mkdir(paths.runDirectory, { recursive: true });
  await writeFile(paths.issuePath, formatJson(issue), "utf8");

  return {
    runDirectory: paths.runDirectory,
    issuePath: paths.issuePath,
    issue
  };
}

export async function writePromptArtifact(
  input: WritePromptArtifactInput
): Promise<WritePromptArtifactResult> {
  const paths = prepareArtifactPaths(input.issueNumber, input.runsDirectory);

  await mkdir(paths.runDirectory, { recursive: true });
  await writeFile(paths.promptPath, input.prompt, "utf8");

  return {
    runDirectory: paths.runDirectory,
    promptPath: paths.promptPath
  };
}

export async function writeRunArtifact(
  input: WriteRunArtifactInput
): Promise<WriteRunArtifactResult> {
  const paths = prepareArtifactPaths(input.issueNumber, input.runsDirectory);
  const run: PrepareRunArtifact = {
    status: "preparing"
  };

  await mkdir(paths.runDirectory, { recursive: true });
  await loadExistingRunArtifactIfPresent(paths.runPath);
  await writeFile(paths.runPath, formatJson(run), "utf8");

  return {
    runDirectory: paths.runDirectory,
    runPath: paths.runPath,
    run
  };
}

export async function updateRunArtifact(
  input: UpdateRunArtifactInput
): Promise<UpdateRunArtifactResult> {
  const paths = prepareArtifactPaths(input.issueNumber, input.runsDirectory);
  const existingRun = await loadExistingRunArtifact(paths.runPath);
  const run = {
    ...existingRun,
    ...buildRunArtifactUpdate(input)
  } as PrepareRunArtifact;

  await writeFile(paths.runPath, formatJson(run), "utf8");

  return {
    runDirectory: paths.runDirectory,
    runPath: paths.runPath,
    run
  };
}

function buildIssueArtifact(issue: IssueDetails): PrepareIssueArtifact {
  return {
    number: issue.issueNumber,
    title: issue.title,
    body: issue.body ?? ""
  };
}

function buildRunArtifactUpdate(
  input: UpdateRunArtifactInput
): Partial<PrepareRunArtifact> {
  return {
    ...(input.issue !== undefined
      ? {
          issueURL: input.issue.url,
          issueTitle: input.issue.title,
          issueNumber: input.issue.issueNumber
        }
      : {}),
    ...(input.worktreePath !== undefined
      ? { worktreePath: input.worktreePath }
      : {}),
    ...(input.branchName !== undefined ? { branch: input.branchName } : {}),
    ...(input.beforeHead !== undefined ? { beforeHead: input.beforeHead } : {}),
    ...(input.status !== undefined ? { status: input.status } : {})
  };
}

export function prepareArtifactPaths(
  issueNumber: number,
  runsDirectory = ".runs"
): PrepareArtifactPaths {
  const runDirectory = join(runsDirectory, `issue-${issueNumber}`);

  return {
    runDirectory,
    promptPath: join(runDirectory, "prompt.md"),
    issuePath: join(runDirectory, "issue.json"),
    runPath: join(runDirectory, "run.json")
  };
}

async function loadExistingRunArtifactIfPresent(
  runPath: string
): Promise<Record<string, unknown> | undefined> {
  let contents;
  try {
    contents = await readFile(runPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  return parseRunArtifact(contents, runPath);
}

async function loadExistingRunArtifact(
  runPath: string
): Promise<Record<string, unknown>> {
  let contents;
  try {
    contents = await readFile(runPath, "utf8");
  } catch {
    throw new Error(`Existing prepare run artifact is required at ${runPath}.`);
  }

  return parseRunArtifact(contents, runPath);
}

function parseRunArtifact(
  contents: string,
  runPath: string
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(
      `Existing prepare run artifact at ${runPath} must be valid JSON.`
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `Existing prepare run artifact at ${runPath} must be a JSON object.`
    );
  }

  return parsed;
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
