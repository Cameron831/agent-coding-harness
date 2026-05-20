#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PARENT_PATH = loadEvalParentPath();

export interface EvalCaseMetadata {
  id: string;
  testCommand: string;
  allowedChangedFiles: string[];
}

export interface EvalRunContext {
  case: EvalCaseMetadata;
  caseID: string;
  runID: string;
  startedAt: string;
  outputsPath: string;
  promptPath: string;
}

export interface EvalWorkspaceSetupSuccess {
  workspacePath: string;
}

export type EvalWorkspaceSetupResult =
  | {
      ok: true;
      value: EvalWorkspaceSetupSuccess;
    }
  | {
      ok: false;
      reason: string;
    };

export interface EvalAgentOrchestrationInput extends EvalRunContext {
  workspacePath: string;
}

export type EvalAgentOrchestrationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: string;
    };

export interface EvalGradingSuccess {
  status: string;
  reason?: string;
}

export type EvalGradingResult =
  | {
      ok: true;
      value: EvalGradingSuccess;
    }
  | {
      ok: false;
      reason: string;
    };

export type EvalWorkspaceSetup = (
  context: EvalRunContext
) => Promise<EvalWorkspaceSetupResult>;

export type EvalAgentOrchestration = (
  input: EvalAgentOrchestrationInput
) => Promise<EvalAgentOrchestrationResult>;

export type EvalGrading = (
  input: EvalAgentOrchestrationInput
) => Promise<EvalGradingResult>;

export type EvalRunClock = () => Date;
export type EvalRunOutput = (message: string) => void;

type EvalCaseLoadResult =
  | {
      ok: true;
      value: EvalCaseMetadata;
    }
  | {
      ok: false;
      reason: string;
    };

export interface EvalRunDependencies {
  repositoryRoot?: string;
  clock?: EvalRunClock;
  stdout?: EvalRunOutput;
  setupWorkspace?: EvalWorkspaceSetup;
  runAgent?: EvalAgentOrchestration;
  grade?: EvalGrading;
}

export interface EvalRunSummary {
  caseID: string;
  runID?: string;
  startedAt?: string;
  outputsPath?: string;
  status: "success" | "failed";
  failureReason?: string;
}

export async function runEvalCase(
  caseID: string,
  dependencies: EvalRunDependencies = {}
): Promise<0 | 1> {
  const stdout = dependencies.stdout ?? console.log;
  const requestedCaseID = caseID.trim();

  if (requestedCaseID === "") {
    stdout(
      formatEvalRunSummary({
        caseID: "(missing)",
        status: "failed",
        failureReason: "caseID is required."
      })
    );
    return 1;
  }

  const repositoryRoot = dependencies.repositoryRoot ?? process.cwd();
  const clock = dependencies.clock ?? (() => new Date());
  const startedAt = clock().toISOString();
  const runID = buildEvalRunID(startedAt);
  const outputsPath = join("evals", requestedCaseID, "outputs", runID);
  const promptPath = join("evals", requestedCaseID, "prompt.md");
  const summaryBase = {
    caseID: requestedCaseID,
    runID,
    startedAt,
    outputsPath
  };

  const loadedCase = await loadEvalCase(repositoryRoot, requestedCaseID);
  if (!loadedCase.ok) {
    stdout(
      formatEvalRunSummary({
        ...summaryBase,
        status: "failed",
        failureReason: loadedCase.reason
      })
    );
    return 1;
  }

  const context: EvalRunContext = {
    case: loadedCase.value,
    caseID: requestedCaseID,
    runID,
    startedAt,
    outputsPath,
    promptPath
  };

  try {
    await mkdir(join(repositoryRoot, outputsPath), { recursive: true });
  } catch (cause) {
    stdout(
      formatEvalRunSummary({
        ...summaryBase,
        status: "failed",
        failureReason: `Unable to create outputs directory: ${messageFromUnknown(cause)}`
      })
    );
    return 1;
  }

  const setupWorkspace = dependencies.setupWorkspace ?? defaultEvalWorkspaceSetup;
  const runAgent = dependencies.runAgent ?? defaultEvalAgentOrchestration;
  const grade = dependencies.grade ?? defaultEvalGrading;

  let workspace;
  try {
    workspace = await setupWorkspace(context);
  } catch (cause) {
    stdout(failureSummary(summaryBase, "Workspace setup failed", cause));
    return 1;
  }
  if (!workspace.ok) {
    stdout(failureSummary(summaryBase, "Workspace setup failed", workspace.reason));
    return 1;
  }

  const agentInput: EvalAgentOrchestrationInput = {
    ...context,
    workspacePath: workspace.value.workspacePath
  };

  let agentResult;
  try {
    agentResult = await runAgent(agentInput);
  } catch (cause) {
    stdout(failureSummary(summaryBase, "Agent orchestration failed", cause));
    return 1;
  }
  if (!agentResult.ok) {
    stdout(
      failureSummary(summaryBase, "Agent orchestration failed", agentResult.reason)
    );
    return 1;
  }

  let gradingResult;
  try {
    gradingResult = await grade(agentInput);
  } catch (cause) {
    stdout(failureSummary(summaryBase, "Grading failed", cause));
    return 1;
  }
  if (!gradingResult.ok) {
    stdout(failureSummary(summaryBase, "Grading failed", gradingResult.reason));
    return 1;
  }
  if (gradingResult.value.status !== "success") {
    stdout(
      formatEvalRunSummary({
        ...summaryBase,
        status: "failed",
        failureReason:
          gradingResult.value.reason ??
          `Grading reported non-success status: ${gradingResult.value.status}.`
      })
    );
    return 1;
  }

  stdout(
    formatEvalRunSummary({
      ...summaryBase,
      status: "success"
    })
  );
  return 0;
}

export function buildEvalRunID(startedAt: string): string {
  return startedAt.replace(/[:.]/g, "-");
}

export function formatEvalRunSummary(summary: EvalRunSummary): string {
  const lines = [
    "Eval run summary",
    `Case ID: ${summary.caseID}`,
    ...(summary.runID !== undefined ? [`Run ID: ${summary.runID}`] : []),
    ...(summary.startedAt !== undefined ? [`Started: ${summary.startedAt}`] : []),
    ...(summary.outputsPath !== undefined ? [`Outputs: ${summary.outputsPath}`] : []),
    `Status: ${summary.status}`
  ];

  if (summary.failureReason !== undefined) {
    lines.push(`Failure: ${summary.failureReason}`);
  }

  return lines.join("\n");
}

async function loadEvalCase(
  repositoryRoot: string,
  requestedCaseID: string
): Promise<EvalCaseLoadResult> {
  const casePath = join(repositoryRoot, "evals", requestedCaseID, "case.json");

  let content;
  try {
    content = await readFile(casePath, "utf8");
  } catch (cause) {
    return {
      ok: false,
      reason: `Unable to load eval case metadata at ${casePath}: ${messageFromUnknown(cause)}`
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    return {
      ok: false,
      reason: `Invalid eval case JSON at ${casePath}: ${messageFromUnknown(cause)}`
    };
  }

  const validated = validateEvalCaseMetadata(parsed, casePath);
  if (!validated.ok) {
    return validated;
  }

  if (validated.value.id !== requestedCaseID) {
    return {
      ok: false,
      reason: `Eval case id ${validated.value.id} does not match requested caseID ${requestedCaseID}.`
    };
  }

  return validated;
}

function validateEvalCaseMetadata(
  value: unknown,
  casePath: string
): EvalCaseLoadResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      reason: `Eval case metadata must be a JSON object: ${casePath}.`
    };
  }

  if (typeof value.id !== "string") {
    return {
      ok: false,
      reason: `Eval case metadata must include a string id: ${casePath}.`
    };
  }

  if (typeof value.testCommand !== "string") {
    return {
      ok: false,
      reason: `Eval case metadata must include a string testCommand: ${casePath}.`
    };
  }

  if (
    !Array.isArray(value.allowedChangedFiles) ||
    value.allowedChangedFiles.some((entry) => typeof entry !== "string")
  ) {
    return {
      ok: false,
      reason: `Eval case metadata must include a string array allowedChangedFiles: ${casePath}.`
    };
  }

  return {
    ok: true,
    value: {
      id: value.id,
      testCommand: value.testCommand,
      allowedChangedFiles: value.allowedChangedFiles
    }
  };
}

async function defaultEvalWorkspaceSetup(
  context: EvalRunContext
): Promise<EvalWorkspaceSetupResult> {
  return {
    ok: true,
    value: {
      workspacePath: context.outputsPath
    }
  };
}

async function defaultEvalAgentOrchestration(): Promise<EvalAgentOrchestrationResult> {
  return { ok: true };
}

async function defaultEvalGrading(): Promise<EvalGradingResult> {
  return {
    ok: true,
    value: {
      status: "success"
    }
  };
}

function failureSummary(
  summaryBase: Omit<EvalRunSummary, "status" | "failureReason">,
  prefix: string,
  cause: unknown
): string {
  return formatEvalRunSummary({
    ...summaryBase,
    status: "failed",
    failureReason: `${prefix}: ${messageFromUnknown(cause)}`
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromUnknown(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function loadEvalParentPath(): string | undefined {
  let contents: string;
  try {
    contents = readFileSync(join(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  return parseEvalEnv(contents).PARENT_PATH;
}

function parseEvalEnv(contents: string): Record<string, string> {
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runEvalCase(process.argv[2] ?? "")
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
