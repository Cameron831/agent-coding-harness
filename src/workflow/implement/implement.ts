import type { GitAutomationClient } from "../../git/client.js";
import { LocalGitAutomationClient } from "../../git/git-client.js";
import type {
  GetDiffResult,
  GitAutomationError,
  GitAutomationErrorCode
} from "../../git/types.js";
import type { ImplementorReleaseMetadata } from "../../parser/release.js";
import {
  runImplementWorkflow,
  type ImplementWorkflowOptions,
  type ImplementWorkflowResult
} from "./agent-orchestrator.js";
import {
  type ImplementArtifactWriterInput,
  type ImplementArtifactWriterResult,
  writeImplementArtifacts
} from "./artifact-writer.js";
import {
  runImplementVerification,
  type ImplementVerificationInput,
  type ImplementVerificationResult
} from "./verification.js";

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

export type ImplementArtifactWriter = (
  input: ImplementArtifactWriterInput
) => Promise<ImplementArtifactWriterResult>;

export interface ImplementIssueWorkflowDependencies {
  agentWorkflow?: ImplementAgentWorkflow;
  verificationRunner?: ImplementVerificationRunner;
  gitClient?: GitAutomationClient;
  writeArtifacts?: ImplementArtifactWriter;
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
  const agentWorkflow = dependencies.agentWorkflow ?? runImplementWorkflow;

  let agentResult;
  try {
    agentResult = await agentWorkflow({
      promptPath: options.promptPath,
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

  const verificationRunner =
    dependencies.verificationRunner ?? runImplementVerification;
  let verification;
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

  const writeArtifacts = dependencies.writeArtifacts ?? writeImplementArtifacts;
  let artifacts;
  try {
    artifacts = await writeArtifacts({
      issueNumber: options.issueNumber,
      diff: diffResult.value.diff,
      verificationOutput: verification.report,
      release: agentResult.value.release,
      ...(settings.runsDirectory !== undefined
        ? { runsDirectory: settings.runsDirectory }
        : {})
    });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  return {
    ok: true,
    value: {
      release: agentResult.value.release,
      verification,
      diff: diffResult.value,
      artifacts
    }
  };
}

export const implementIssueWorkflow = runImplementIssueWorkflow;

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
