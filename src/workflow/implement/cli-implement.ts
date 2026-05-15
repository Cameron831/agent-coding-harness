#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { IssueDetails } from "../../github/types.js";
import { renderFeedbackPrompt } from "../prompt-builder.js";
import {
  runImplementIssueWorkflow,
  type ImplementIssueWorkflowDependencies,
  type ImplementIssueWorkflowOptions,
  type ImplementIssueWorkflowResult
} from "./implement.js";

export interface ImplementCliOptions {
  issueNumber: number;
  runsDirectory?: string;
  feedback?: string;
}

export type ImplementCliParseResult =
  | {
      ok: true;
      value: ImplementCliOptions;
    }
  | {
      ok: false;
      message: string;
    };

export type ImplementWorkflowRunner = (
  options: ImplementIssueWorkflowOptions,
  dependencies?: ImplementIssueWorkflowDependencies
) => Promise<ImplementIssueWorkflowResult>;

export interface RunImplementCliOptions {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  runImplementIssueWorkflow?: ImplementWorkflowRunner;
  workflowDependencies?: ImplementIssueWorkflowDependencies;
}

const valueFlags = new Set(["--issue", "--runs-dir", "--feedback"]);

export function formatImplementUsage(): string {
  return [
    "Usage:",
    "  agent-workforce implement --issue <number> [options]",
    "",
    "Options:",
    "  --issue <number>       GitHub issue number to implement.",
    "  --runs-dir <path>      Directory for implement run artifacts.",
    "  --feedback <text>      Feedback text for an implement rerun."
  ].join("\n");
}

export function parseImplementCliArgs(
  args: readonly string[]
): ImplementCliParseResult {
  let issueNumber: number | undefined;
  let runsDirectory: string | undefined;
  let feedback: string | undefined;
  const seenFlags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (valueFlags.has(arg)) {
      if (seenFlags.has(arg)) {
        return usageFailure(`${arg} may only be provided once.`);
      }
      seenFlags.add(arg);

      const value = args[index + 1];
      if (
        value === undefined ||
        value.startsWith("--") ||
        value === "" ||
        (arg === "--feedback" && value.trim() === "")
      ) {
        return usageFailure(`${arg} requires a value.`);
      }

      if (arg === "--issue") {
        const parsed = parseIssueNumber(value);
        if (parsed === undefined) {
          return usageFailure("--issue must be a positive integer.");
        }
        issueNumber = parsed;
      } else if (arg === "--feedback") {
        feedback = value;
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

  return {
    ok: true,
    value: {
      issueNumber,
      ...(runsDirectory !== undefined ? { runsDirectory } : {}),
      ...(feedback !== undefined ? { feedback } : {})
    }
  };
}

export async function runImplementCli(
  args: readonly string[],
  options: RunImplementCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const parsed = parseImplementCliArgs(args);

  if (!parsed.ok) {
    stderr([parsed.message, "", formatImplementUsage()].join("\n"));
    return 1;
  }

  let workflowOptions: ImplementIssueWorkflowOptions;
  try {
    workflowOptions = await deriveImplementWorkflowOptions(parsed.value);
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const runWorkflow =
    options.runImplementIssueWorkflow ?? runImplementIssueWorkflow;
  const result = await runWorkflow(workflowOptions, options.workflowDependencies);

  if (!result.ok) {
    stderr(
      `Implement workflow failed at ${result.error.stage}: ${result.error.message}`
    );
    return 1;
  }

  stdout(formatImplementSuccess(result.value));
  return 0;
}

export function formatImplementSuccess(
  value: Extract<ImplementIssueWorkflowResult, { ok: true }>["value"]
): string {
  return [
    `Implemented issue #${value.verification.issueNumber}: ${value.release.pull_request.title}`,
    `Verification: ${value.verification.status}`,
    `Diff: ${value.artifacts.diffPath}`,
    `Verification output: ${value.artifacts.verificationOutputPath}`,
    `Release: ${value.artifacts.releasePath}`,
    `Run artifact: ${value.artifacts.runPath}`
  ].join("\n");
}

function parseIssueNumber(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function deriveImplementWorkflowOptions(
  options: ImplementCliOptions
): Promise<ImplementIssueWorkflowOptions> {
  const runsDirectory = options.runsDirectory ?? ".runs";
  const runDirectory = join(runsDirectory, `issue-${options.issueNumber}`);
  const promptPath = join(
    runDirectory,
    options.feedback === undefined ? "prompt.md" : "feedback-prompt.md"
  );
  const runPath = join(runDirectory, "run.json");
  const run = await loadRunArtifact(runPath);

  if (options.feedback !== undefined) {
    const issuePath = join(runDirectory, "issue.json");
    const releasePath = join(runDirectory, "release.json");
    const issue = await loadIssueArtifact(issuePath, options.issueNumber);
    const releaseJson = await loadRawArtifact(releasePath, "release artifact");
    const prompt = await renderFeedbackPrompt({
      issue,
      feedback: options.feedback,
      releaseJson
    });
    await writeFile(promptPath, prompt, "utf8");
  }

  return {
    issueNumber: options.issueNumber,
    promptPath,
    targetWorktreePath: run.worktreePath,
    beforeHead: run.beforeHead,
    ...(options.runsDirectory !== undefined
      ? { runsDirectory: options.runsDirectory }
      : {})
  };
}

async function loadRunArtifact(runPath: string): Promise<{
  worktreePath: string;
  beforeHead: string;
}> {
  let content;
  try {
    content = await readFile(runPath, "utf8");
  } catch (cause) {
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? cause.code
        : undefined;
    if (code === "ENOENT") {
      throw new Error(`Implement run artifact not found: ${runPath}.`);
    }
    throw new Error(
      `Unable to read implement run artifact at ${runPath}: ${messageFromUnknown(cause)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw new Error(
      `Invalid implement run artifact JSON at ${runPath}: ${messageFromUnknown(cause)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Implement run artifact must be a JSON object: ${runPath}.`);
  }

  const worktreePath = getStringProperty(parsed, "worktreePath");
  if (worktreePath === undefined) {
    throw new Error(
      `Implement run artifact is missing required string worktreePath: ${runPath}.`
    );
  }

  const beforeHead = getStringProperty(parsed, "beforeHead");
  if (beforeHead === undefined) {
    throw new Error(
      `Implement run artifact is missing required string beforeHead: ${runPath}.`
    );
  }

  return { worktreePath, beforeHead };
}

async function loadIssueArtifact(
  issuePath: string,
  expectedIssueNumber: number
): Promise<IssueDetails> {
  const content = await loadRawArtifact(issuePath, "issue artifact");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw new Error(
      `Invalid issue artifact JSON at ${issuePath}: ${messageFromUnknown(cause)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Issue artifact must be a JSON object: ${issuePath}.`);
  }

  const number = getNumberProperty(parsed, "number");
  if (number === undefined) {
    throw new Error(
      `Issue artifact is missing required positive integer number: ${issuePath}.`
    );
  }

  if (number !== expectedIssueNumber) {
    throw new Error(
      `Issue artifact number ${number} does not match requested issue ${expectedIssueNumber}: ${issuePath}.`
    );
  }

  const title = getStringProperty(parsed, "title");
  if (title === undefined) {
    throw new Error(
      `Issue artifact is missing required string title: ${issuePath}.`
    );
  }

  const body = getStringProperty(parsed, "body", { allowEmpty: true });
  if (body === undefined) {
    throw new Error(
      `Issue artifact is missing required string body: ${issuePath}.`
    );
  }

  return {
    issueNumber: number,
    title,
    body,
    state: "open",
    url: ""
  };
}

async function loadRawArtifact(
  artifactPath: string,
  artifactName: string
): Promise<string> {
  try {
    return await readFile(artifactPath, "utf8");
  } catch (cause) {
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? cause.code
        : undefined;
    if (code === "ENOENT") {
      throw new Error(`Implement ${artifactName} not found: ${artifactPath}.`);
    }
    throw new Error(
      `Unable to read implement ${artifactName} at ${artifactPath}: ${messageFromUnknown(cause)}`
    );
  }
}

function getNumberProperty(
  value: object,
  propertyName: "number"
): number | undefined {
  const record = value as Record<string, unknown>;
  if (!(propertyName in record)) {
    return undefined;
  }

  const propertyValue = record[propertyName];
  return typeof propertyValue === "number" &&
    Number.isSafeInteger(propertyValue) &&
    propertyValue > 0
    ? propertyValue
    : undefined;
}

function getStringProperty(
  value: object,
  propertyName: "worktreePath" | "beforeHead" | "title" | "body",
  options: { allowEmpty?: boolean } = {}
): string | undefined {
  const record = value as Record<string, unknown>;
  if (!(propertyName in record)) {
    return undefined;
  }

  const propertyValue = record[propertyName];
  return typeof propertyValue === "string" &&
    (options.allowEmpty === true || propertyValue.trim() !== "")
    ? propertyValue
    : undefined;
}

function messageFromUnknown(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function usageFailure(message: string): ImplementCliParseResult {
  return { ok: false, message };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runImplementCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
