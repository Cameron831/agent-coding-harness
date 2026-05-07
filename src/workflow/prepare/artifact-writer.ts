import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IssueDetails } from "../../github/types.js";

export type PrepareRunStatus =
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

export interface PrepareRunArtifact {
  status: PrepareRunStatus;
  issueURL: string;
  issueTitle: string;
  issueNumber: number;
  worktreePath: string;
  branch: string;
}

export interface WritePrepareArtifactsInput {
  issue: IssueDetails;
  /**
   * Written exactly as supplied, without newline normalization or trailing
   * newline insertion.
   */
  prompt: string;
  worktreePath: string;
  branchName: string;
  runsDirectory?: string;
}

export type PrepareArtifactWriterInput = WritePrepareArtifactsInput;

export interface WritePrepareArtifactsResult {
  runDirectory: string;
  promptPath: string;
  issuePath: string;
  runPath: string;
  issue: PrepareIssueArtifact;
  run: PrepareRunArtifact;
}

export type PrepareArtifactWriterResult = WritePrepareArtifactsResult;

export async function writePrepareArtifacts(
  input: WritePrepareArtifactsInput
): Promise<WritePrepareArtifactsResult> {
  const runsDirectory = input.runsDirectory ?? ".runs";
  const runDirectory = join(
    runsDirectory,
    `issue-${input.issue.issueNumber}`
  );
  const promptPath = join(runDirectory, "prompt.md");
  const issuePath = join(runDirectory, "issue.json");
  const runPath = join(runDirectory, "run.json");
  const issue = buildIssueArtifact(input.issue);
  const run = buildRunArtifact(input);

  await mkdir(runDirectory, { recursive: true });
  await writeFile(promptPath, input.prompt, "utf8");
  await writeFile(issuePath, formatJson(issue), "utf8");
  await writeFile(runPath, formatJson(run), "utf8");

  return {
    runDirectory,
    promptPath,
    issuePath,
    runPath,
    issue,
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

function buildRunArtifact(input: WritePrepareArtifactsInput): PrepareRunArtifact {
  return {
    status: "prepared",
    issueURL: input.issue.url,
    issueTitle: input.issue.title,
    issueNumber: input.issue.issueNumber,
    worktreePath: input.worktreePath,
    branch: input.branchName
  };
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
