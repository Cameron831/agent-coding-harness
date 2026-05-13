import { readFile, writeFile } from "node:fs/promises";

export interface RunPathInput {
  runPath: string;
}

export interface PublishedRunInput extends RunPathInput {
  pullRequestURL: string;
}

export interface ReleaseRunArtifactResult {
  runPath: string;
  run: Record<string, unknown>;
}

export async function loadReleaseRunArtifact(
  input: RunPathInput
): Promise<Record<string, unknown>> {
  let contents;
  try {
    contents = await readFile(input.runPath, "utf8");
  } catch {
    throw new Error(`Existing release run artifact is required at ${input.runPath}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(
      `Existing release run artifact at ${input.runPath} must be valid JSON.`
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `Existing release run artifact at ${input.runPath} must be a JSON object.`
    );
  }

  return parsed;
}

export async function writeReleasePublishingRunArtifact(
  input: RunPathInput
): Promise<ReleaseRunArtifactResult> {
  const existingRun = await loadReleaseRunArtifact(input);

  const run = {
    ...existingRun,
    status: "publishing"
  };

  await writeFile(input.runPath, formatJson(run), "utf8");

  return {
    runPath: input.runPath,
    run
  };
}

export async function writeReleasePublishedRunArtifact(
  input: PublishedRunInput
): Promise<ReleaseRunArtifactResult> {
  const existingRun = await loadReleaseRunArtifact(input);
  validatePullRequestURL(input.pullRequestURL, input.runPath);

  const run = {
    ...existingRun,
    status: "published",
    pullRequestURL: input.pullRequestURL
  };

  await writeFile(input.runPath, formatJson(run), "utf8");

  return {
    runPath: input.runPath,
    run
  };
}

function validatePullRequestURL(pullRequestURL: string, runPath: string): void {
  if (typeof pullRequestURL !== "string" || pullRequestURL.trim() === "") {
    throw new Error(
      [
        `Release run artifact at ${runPath} cannot be marked published.`,
        "Release run field pullRequestURL must be a non-empty string."
      ].join("\n")
    );
  }
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
