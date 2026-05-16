import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImplementorReleaseMetadata } from "../../parser/release.js";

export type ImplementRunStatus = "implementing" | "needsFeedback";

export interface ImplementRunArtifactUpdate {
  status: ImplementRunStatus;
}

export type ImplementRunArtifact = Record<string, unknown> & {
  status: ImplementRunStatus;
};

export interface ImplementArtifactPathInput {
  issueNumber: number;
  runsDirectory?: string;
}

export interface WriteReleaseArtifactInput extends ImplementArtifactPathInput {
  release: ImplementorReleaseMetadata;
}

export interface WriteVerificationArtifactInput extends ImplementArtifactPathInput {
  /**
   * Written exactly as supplied, without newline normalization or trailing
   * newline insertion.
   */
  verificationOutput: string;
}

export interface WriteDiffArtifactInput extends ImplementArtifactPathInput {
  /**
   * Written exactly as supplied, without newline normalization or trailing
   * newline insertion.
   */
  diff: string;
}

export interface UpdateRunArtifactInput extends ImplementArtifactPathInput {
  status?: ImplementRunStatus;
}

export interface ImplementArtifactPaths {
  runDirectory: string;
  diffPath: string;
  verificationOutputPath: string;
  releasePath: string;
  runPath: string;
}

export interface WriteReleaseArtifactResult {
  runDirectory: string;
  releasePath: string;
  release: ImplementorReleaseMetadata;
}

export interface WriteVerificationArtifactResult {
  runDirectory: string;
  verificationOutputPath: string;
}

export interface WriteDiffArtifactResult {
  runDirectory: string;
  diffPath: string;
}

export interface UpdateRunArtifactResult {
  runDirectory: string;
  runPath: string;
  run: ImplementRunArtifact;
}

export interface ImplementArtifactWriterResult {
  runDirectory: string;
  diffPath: string;
  verificationOutputPath: string;
  releasePath: string;
  runPath: string;
  release: ImplementorReleaseMetadata;
  run: ImplementRunArtifact;
}

export async function writeReleaseArtifact(
  input: WriteReleaseArtifactInput
): Promise<WriteReleaseArtifactResult> {
  const paths = getImplementArtifactPaths(input);

  await mkdir(paths.runDirectory, { recursive: true });
  await writeFile(paths.releasePath, formatJson(input.release), "utf8");

  return {
    runDirectory: paths.runDirectory,
    releasePath: paths.releasePath,
    release: input.release
  };
}

export async function writeVerificationArtifact(
  input: WriteVerificationArtifactInput
): Promise<WriteVerificationArtifactResult> {
  const paths = getImplementArtifactPaths(input);

  await mkdir(paths.runDirectory, { recursive: true });
  await writeFile(paths.verificationOutputPath, input.verificationOutput, "utf8");

  return {
    runDirectory: paths.runDirectory,
    verificationOutputPath: paths.verificationOutputPath
  };
}

export async function writeDiffArtifact(
  input: WriteDiffArtifactInput
): Promise<WriteDiffArtifactResult> {
  const paths = getImplementArtifactPaths(input);

  await mkdir(paths.runDirectory, { recursive: true });
  await writeFile(paths.diffPath, input.diff, "utf8");

  return {
    runDirectory: paths.runDirectory,
    diffPath: paths.diffPath
  };
}

export async function updateRunArtifact(
  input: UpdateRunArtifactInput
): Promise<UpdateRunArtifactResult> {
  const paths = getImplementArtifactPaths(input);

  await mkdir(paths.runDirectory, { recursive: true });

  const existingRun = await loadExistingRunArtifact(paths.runPath);
  const runUpdate: ImplementRunArtifactUpdate = {
    status: input.status ?? "needsFeedback"
  };
  const run: ImplementRunArtifact = {
    ...existingRun,
    ...runUpdate
  };

  await writeFile(paths.runPath, formatJson(run), "utf8");

  return {
    runDirectory: paths.runDirectory,
    runPath: paths.runPath,
    run
  };
}

export function getImplementArtifactPaths(
  input: ImplementArtifactPathInput
): ImplementArtifactPaths {
  const runsDirectory = input.runsDirectory ?? ".runs";
  const runDirectory = join(runsDirectory, `issue-${input.issueNumber}`);

  return {
    runDirectory,
    diffPath: join(runDirectory, "diff.patch"),
    verificationOutputPath: join(runDirectory, "verification.txt"),
    releasePath: join(runDirectory, "release.json"),
    runPath: join(runDirectory, "run.json")
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
