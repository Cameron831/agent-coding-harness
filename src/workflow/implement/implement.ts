import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitAutomationClient } from "../../git/client.js";
import { LocalGitAutomationClient } from "../../git/git-client.js";
import type {
  GetDiffResult,
  GitAutomationError,
  GitAutomationErrorCode
} from "../../git/types.js";
import type { IssueDetails } from "../../github/types.js";
import type { ImplementorReleaseMetadata } from "../../parser/release.js";
import { renderFeedbackPrompt } from "../prompt-builder.js";
import {
  runImplementWorkflow,
  type ImplementWorkflowOptions,
  type ImplementWorkflowResult
} from "./agent-orchestrator.js";
import {
  type ImplementArtifactWriterResult,
  type UpdateRunArtifactInput,
  type UpdateRunArtifactResult,
  type WriteDiffArtifactInput,
  type WriteDiffArtifactResult,
  type WriteReleaseArtifactInput,
  type WriteReleaseArtifactResult,
  type WriteVerificationArtifactInput,
  type WriteVerificationArtifactResult,
  updateRunArtifact as defaultUpdateRunArtifact,
  writeDiffArtifact as defaultWriteDiffArtifact,
  writeReleaseArtifact as defaultWriteReleaseArtifact,
  writeVerificationArtifact as defaultWriteVerificationArtifact
} from "./artifact-writer.js";
import {
  runImplementVerification,
  type ImplementVerificationInput,
  type ImplementVerificationResult
} from "./verification.js";

const AUTOMATIC_VERIFICATION_RETRY_LIMIT = 1;

export interface ImplementIssueWorkflowSettings {
  runsDirectory?: string;
  testCommand?: string;
  verificationCommand?: string;
}

export interface ImplementIssueWorkflowOptions
  extends ImplementIssueWorkflowSettings {
  promptPath: string;
  targetWorktreePath: string;
  issueNumber: number;
  beforeHead: string;
  settings?: ImplementIssueWorkflowSettings;
}

export type ImplementAgentWorkflow = (
  options: ImplementWorkflowOptions
) => Promise<ImplementWorkflowResult>;

export type ImplementVerificationRunner = (
  input: ImplementVerificationInput
) => Promise<ImplementVerificationResult>;

export type ImplementReleaseArtifactWriter = (
  input: WriteReleaseArtifactInput
) => Promise<WriteReleaseArtifactResult>;

export type ImplementVerificationArtifactWriter = (
  input: WriteVerificationArtifactInput
) => Promise<WriteVerificationArtifactResult>;

export type ImplementDiffArtifactWriter = (
  input: WriteDiffArtifactInput
) => Promise<WriteDiffArtifactResult>;

export type ImplementRunArtifactWriter = (
  input: UpdateRunArtifactInput
) => Promise<UpdateRunArtifactResult>;

export interface ImplementIssueWorkflowDependencies {
  agentWorkflow?: ImplementAgentWorkflow;
  verificationRunner?: ImplementVerificationRunner;
  gitClient?: GitAutomationClient;
  writeReleaseArtifact?: ImplementReleaseArtifactWriter;
  writeVerificationArtifact?: ImplementVerificationArtifactWriter;
  writeDiffArtifact?: ImplementDiffArtifactWriter;
  updateRunArtifact?: ImplementRunArtifactWriter;
}

export type ImplementIssueWorkflowFailureStage =
  | "agent_orchestration"
  | "verification"
  | "diff"
  | "artifact_write";

export interface ImplementIssueWorkflowError {
  stage: ImplementIssueWorkflowFailureStage;
  code: GitAutomationErrorCode | "unknown";
  message: string;
  cause?: unknown;
}

export interface ImplementIssueWorkflowSuccess {
  release: ImplementorReleaseMetadata;
  verification: ImplementVerificationResult;
  diff: GetDiffResult;
  artifacts: ImplementArtifactWriterResult;
}

export type ImplementIssueWorkflowResult =
  | {
      ok: true;
      value: ImplementIssueWorkflowSuccess;
    }
  | {
      ok: false;
      error: ImplementIssueWorkflowError;
    };

export async function runImplementIssueWorkflow(
  options: ImplementIssueWorkflowOptions,
  dependencies: ImplementIssueWorkflowDependencies = {}
): Promise<ImplementIssueWorkflowResult> {
  const settings = resolveSettings(options);
  const artifactPathInput = {
    issueNumber: options.issueNumber,
    ...(settings.runsDirectory !== undefined
      ? { runsDirectory: settings.runsDirectory }
      : {})
  };
  const writeRun =
    dependencies.updateRunArtifact ?? defaultUpdateRunArtifact;
  const writeRelease =
    dependencies.writeReleaseArtifact ?? defaultWriteReleaseArtifact;
  const writeVerification =
    dependencies.writeVerificationArtifact ?? defaultWriteVerificationArtifact;
  const writeDiff =
    dependencies.writeDiffArtifact ?? defaultWriteDiffArtifact;

  try {
    await writeRun({
      ...artifactPathInput,
      status: "implementing"
    });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  const agentWorkflow = dependencies.agentWorkflow ?? runImplementWorkflow;
  const verificationRunner =
    dependencies.verificationRunner ?? runImplementVerification;

  let promptPath = options.promptPath;
  let releaseArtifact: WriteReleaseArtifactResult | undefined;
  let verification: ImplementVerificationResult | undefined;
  let verificationArtifact: WriteVerificationArtifactResult | undefined;

  for (
    let attemptIndex = 0;
    attemptIndex <= AUTOMATIC_VERIFICATION_RETRY_LIMIT;
    attemptIndex += 1
  ) {
    let agentResult: ImplementWorkflowResult;
    try {
      agentResult = await agentWorkflow({
        promptPath,
        targetWorktreePath: options.targetWorktreePath
      });
    } catch (cause) {
      return failureFromThrown("agent_orchestration", cause);
    }

    if (!agentResult.ok) {
      return {
        ok: false,
        error: {
          stage: "agent_orchestration",
          code: "unknown",
          message: agentResult.error.message,
          cause: agentResult.error
        }
      };
    }

    try {
      releaseArtifact = await writeRelease({
        ...artifactPathInput,
        release: agentResult.value.release
      });
    } catch (cause) {
      return failureFromThrown("artifact_write", cause);
    }

    try {
      verification = await verificationRunner({
        issueNumber: options.issueNumber,
        targetWorktreePath: options.targetWorktreePath,
        beforeHead: options.beforeHead,
        ...(settings.testCommand !== undefined
          ? { testCommand: settings.testCommand }
          : {})
      });
    } catch (cause) {
      return failureFromThrown("verification", cause);
    }

    try {
      verificationArtifact = await writeVerification({
        ...artifactPathInput,
        verificationOutput: verification.report
      });
    } catch (cause) {
      return failureFromThrown("artifact_write", cause);
    }

    if (
      verification.status === "passed" ||
      attemptIndex >= AUTOMATIC_VERIFICATION_RETRY_LIMIT
    ) {
      break;
    }

    try {
      promptPath = await writeAutomaticRetryPrompt({
        ...artifactPathInput,
        issueNumber: options.issueNumber,
        release: releaseArtifact.release,
        verification
      });
    } catch (cause) {
      return failureFromThrown("artifact_write", cause);
    }
  }

  if (
    releaseArtifact === undefined ||
    verification === undefined ||
    verificationArtifact === undefined
  ) {
    return failureFromThrown(
      "agent_orchestration",
      new Error("Implement workflow completed without an implementation attempt.")
    );
  }

  const gitClient = dependencies.gitClient ?? new LocalGitAutomationClient();
  let diffResult;
  try {
    diffResult = await gitClient.getDiff({
      targetWorktreePath: options.targetWorktreePath
    });
  } catch (cause) {
    return failureFromThrown("diff", cause);
  }

  if (!diffResult.ok) {
    return failureFromGitError("diff", diffResult.error);
  }

  let diffArtifact;
  try {
    diffArtifact = await writeDiff({
      ...artifactPathInput,
      diff: diffResult.value.diff
    });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  let runArtifact;
  try {
    runArtifact = await writeRun({
      ...artifactPathInput,
      status: "needsFeedback"
    });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  const artifacts: ImplementArtifactWriterResult = {
    runDirectory: runArtifact.runDirectory,
    diffPath: diffArtifact.diffPath,
    verificationOutputPath: verificationArtifact.verificationOutputPath,
    releasePath: releaseArtifact.releasePath,
    runPath: runArtifact.runPath,
    release: releaseArtifact.release,
    run: runArtifact.run
  };

  return {
    ok: true,
    value: {
      release: releaseArtifact.release,
      verification,
      diff: diffResult.value,
      artifacts
    }
  };
}

export const implementIssueWorkflow = runImplementIssueWorkflow;

async function writeAutomaticRetryPrompt(
  input: {
    issueNumber: number;
    runsDirectory?: string;
    release: ImplementorReleaseMetadata;
    verification: ImplementVerificationResult;
  }
): Promise<string> {
  const runDirectory = join(
    input.runsDirectory ?? ".runs",
    `issue-${input.issueNumber}`
  );
  const issuePath = join(runDirectory, "issue.json");
  const feedbackPromptPath = join(runDirectory, "feedback-prompt.md");
  const issue = await loadIssueArtifact(issuePath, input.issueNumber);
  const prompt = await renderFeedbackPrompt({
    issue,
    feedback: renderAutomaticVerificationFeedback(input.verification),
    releaseJson: formatJson(input.release)
  });

  await writeFile(feedbackPromptPath, prompt, "utf8");
  return feedbackPromptPath;
}

async function loadIssueArtifact(
  issuePath: string,
  expectedIssueNumber: number
): Promise<IssueDetails> {
  let content;
  try {
    content = await readFile(issuePath, "utf8");
  } catch (cause) {
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? cause.code
        : undefined;
    if (code === "ENOENT") {
      throw new Error(`Implement issue artifact not found: ${issuePath}.`);
    }
    throw new Error(
      `Unable to read implement issue artifact at ${issuePath}: ${messageFromUnknown(cause)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw new Error(
      `Invalid issue artifact JSON at ${issuePath}: ${messageFromUnknown(cause)}`
    );
  }

  if (!isRecord(parsed)) {
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

function renderAutomaticVerificationFeedback(
  verification: ImplementVerificationResult
): string {
  return [
    "Automatic verification failed after the implementation attempt.",
    "Use the verification report below as the feedback for one targeted retry.",
    "",
    verification.report
  ].join("\n");
}

function resolveSettings(
  options: ImplementIssueWorkflowOptions
): ImplementIssueWorkflowSettings {
  return {
    runsDirectory: options.settings?.runsDirectory ?? options.runsDirectory,
    testCommand:
      options.settings?.testCommand ??
      options.testCommand ??
      options.settings?.verificationCommand ??
      options.verificationCommand
  };
}

function failureFromGitError(
  stage: ImplementIssueWorkflowFailureStage,
  error: GitAutomationError
): ImplementIssueWorkflowResult {
  return {
    ok: false,
    error: {
      stage,
      code: error.code,
      message: error.message,
      ...(error.cause !== undefined ? { cause: error.cause } : {})
    }
  };
}

function failureFromThrown(
  stage: ImplementIssueWorkflowFailureStage,
  cause: unknown
): ImplementIssueWorkflowResult {
  return {
    ok: false,
    error: {
      stage,
      code: "unknown",
      message: cause instanceof Error ? cause.message : String(cause),
      cause
    }
  };
}

function getNumberProperty(
  value: Record<string, unknown>,
  propertyName: "number"
): number | undefined {
  const propertyValue = value[propertyName];
  return typeof propertyValue === "number" &&
    Number.isSafeInteger(propertyValue) &&
    propertyValue > 0
    ? propertyValue
    : undefined;
}

function getStringProperty(
  value: Record<string, unknown>,
  propertyName: "title" | "body",
  options: { allowEmpty?: boolean } = {}
): string | undefined {
  const propertyValue = value[propertyName];
  return typeof propertyValue === "string" &&
    (options.allowEmpty === true || propertyValue.trim() !== "")
    ? propertyValue
    : undefined;
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromUnknown(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
