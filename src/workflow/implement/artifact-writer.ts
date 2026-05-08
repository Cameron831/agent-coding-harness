import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImplementorReleaseMetadata } from "../../parser/release.js";

export type ImplementRunStatus = "needsFeedback";

export interface ImplementRunArtifactUpdate {
  status: ImplementRunStatus;
}

export type ImplementRunArtifact = Record<string, unknown> & {
  status: ImplementRunStatus;
};

export interface WriteImplementArtifactsInput {
  issueNumber: number;
  /**
   * Written exactly as supplied, without newline normalization or trailing
   * newline insertion.
   */
  diff: string;
  /**
   * Written exactly as supplied, without newline normalization or trailing
   * newline insertion.
   */
  verificationOutput: string;
  release: ImplementorReleaseMetadata;
  runsDirectory?: string;
  status?: ImplementRunStatus;
}

export type ImplementArtifactWriterInput = WriteImplementArtifactsInput;

export interface WriteImplementArtifactsResult {
  runDirectory: string;
  diffPath: string;
  verificationOutputPath: string;
  releasePath: string;
  runPath: string;
  release: ImplementorReleaseMetadata;
  run: ImplementRunArtifact;
}

export type ImplementArtifactWriterResult = WriteImplementArtifactsResult;

export async function writeImplementArtifacts(
  input: WriteImplementArtifactsInput
): Promise<WriteImplementArtifactsResult> {
  const runsDirectory = input.runsDirectory ?? ".runs";
  const runDirectory = join(runsDirectory, `issue-${input.issueNumber}`);
  const diffPath = join(runDirectory, "diff.patch");
  const verificationOutputPath = join(runDirectory, "verification.txt");
  const releasePath = join(runDirectory, "release.json");
  const runPath = join(runDirectory, "run.json");

  await mkdir(runDirectory, { recursive: true });

  const existingRun = await loadExistingRunArtifact(runPath);
  const runUpdate: ImplementRunArtifactUpdate = {
    status: input.status ?? "needsFeedback"
  };
  const run: ImplementRunArtifact = {
    ...existingRun,
    ...runUpdate
  };

  await writeFile(diffPath, input.diff, "utf8");
  await writeFile(verificationOutputPath, input.verificationOutput, "utf8");
  await writeFile(releasePath, formatJson(input.release), "utf8");
  await writeFile(runPath, formatJson(run), "utf8");

  return {
    runDirectory,
    diffPath,
    verificationOutputPath,
    releasePath,
    runPath,
    release: input.release,
    run
  };
}

async function loadExistingRunArtifact(runPath: string): Promise<Record<string, unknown>> {
  let contents;
  try {
    contents = await readFile(runPath, "utf8");
  } catch {
    throw new Error(`Existing run artifact is required at ${runPath}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`Existing run artifact at ${runPath} must be valid JSON.`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Existing run artifact at ${runPath} must be a JSON object.`);
  }

  return parsed;
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
