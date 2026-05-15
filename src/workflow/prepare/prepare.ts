import { GhGitHubAutomationClient } from "../../github/gh-client.js";
import type { GitHubAutomationClient } from "../../github/client.js";
import { LocalGitAutomationClient } from "../../git/git-client.js";
import type {
  AutomationErrorCode,
  GitHubAutomationError,
  IssueDetails,
  RepositorySelection
} from "../../github/types.js";
import type { GitAutomationClient } from "../../git/client.js";
import type { GitAutomationError } from "../../git/types.js";
import {
  type PrepareArtifactWriterInput,
  type PrepareArtifactWriterResult,
  writePrepareArtifacts
} from "./artifact-writer.js";
import {
  renderImplementPrompt,
  type ImplementPromptVariant,
  type RenderImplementPromptInput
} from "../prompt-builder.js";
import {
  prepareIssueWorkspace,
  type PrepareIssueWorkspaceDependencies,
  type PrepareIssueWorkspaceInput,
  type PrepareIssueWorkspaceResult
} from "./workspace-prep.js";

export interface PrepareWorkflowSettings {
  baseRef?: string;
  promptVariant?: ImplementPromptVariant;
  variant?: ImplementPromptVariant;
  promptsDirectory?: string;
  runsDirectory?: string;
}

export interface PrepareWorkflowOptions extends PrepareWorkflowSettings {
  repository?: RepositorySelection;
  issueNumber: number;
  targetRepositoryPath: string;
  worktreeParentPath: string;
  settings?: PrepareWorkflowSettings;
}

export type PrepareWorkspaceFunction = (
  input: PrepareIssueWorkspaceInput,
  dependencies?: PrepareIssueWorkspaceDependencies
) => Promise<PrepareIssueWorkspaceResult>;

export type PreparePromptRenderer = (
  input: RenderImplementPromptInput
) => Promise<string>;

export type PrepareArtifactWriter = (
  input: PrepareArtifactWriterInput
) => Promise<PrepareArtifactWriterResult>;

export interface PrepareWorkflowDependencies {
  githubClient?: GitHubAutomationClient;
  createGitHubClient?: () => GitHubAutomationClient;
  gitClient?: GitAutomationClient;
  prepareWorkspace?: PrepareWorkspaceFunction;
  renderPrompt?: PreparePromptRenderer;
  writeArtifacts?: PrepareArtifactWriter;
}

export type PrepareWorkflowFailureStage =
  | "issue_fetch"
  | "workspace_prep"
  | "prompt_render"
  | "artifact_write";

export interface PrepareWorkflowError {
  stage: PrepareWorkflowFailureStage;
  code: AutomationErrorCode;
  message: string;
  cause?: unknown;
}

export interface PrepareWorkflowSuccess {
  issue: IssueDetails;
  promptPath: string;
  issuePath: string;
  runPath: string;
  branchName: string;
  branch: string;
  worktreePath: string;
  artifacts: PrepareArtifactWriterResult;
}

export type PrepareWorkflowResult =
  | {
      ok: true;
      value: PrepareWorkflowSuccess;
    }
  | {
      ok: false;
      error: PrepareWorkflowError;
    };

export async function runPrepareWorkflow(
  options: PrepareWorkflowOptions,
  dependencies: PrepareWorkflowDependencies = {}
): Promise<PrepareWorkflowResult> {
  const settings = resolveSettings(options);
  const githubClient =
    dependencies.githubClient ??
    dependencies.createGitHubClient?.() ??
    new GhGitHubAutomationClient();

  let issueResult;
  try {
    issueResult = await githubClient.getIssue({
      repository: options.repository,
      issueNumber: options.issueNumber
    });
  } catch (cause) {
    return failureFromThrown("issue_fetch", cause);
  }

  if (!issueResult.ok) {
    return failureFromAutomationError("issue_fetch", issueResult.error);
  }

  const issue = issueResult.value;
  const gitClient = dependencies.gitClient ?? new LocalGitAutomationClient();
  const prepareWorkspace = dependencies.prepareWorkspace ?? prepareIssueWorkspace;
  let workspaceResult;
  try {
    workspaceResult = await prepareWorkspace(
      {
        issueNumber: issue.issueNumber,
        issueTitle: issue.title,
        targetRepositoryPath: options.targetRepositoryPath,
        worktreeParentPath: options.worktreeParentPath,
        ...(settings.baseRef !== undefined ? { baseRef: settings.baseRef } : {})
      },
      { gitClient }
    );
  } catch (cause) {
    return failureFromThrown("workspace_prep", cause);
  }

  if (!workspaceResult.ok) {
    return failureFromAutomationError("workspace_prep", workspaceResult.error);
  }

  let headResult;
  try {
    headResult = await gitClient.getHead({
      targetWorktreePath: workspaceResult.value.targetWorktreePath
    });
  } catch (cause) {
    return failureFromThrown("workspace_prep", cause);
  }

  if (!headResult.ok) {
    return failureFromAutomationError("workspace_prep", headResult.error);
  }

  const renderPrompt = dependencies.renderPrompt ?? renderImplementPrompt;
  let prompt;
  try {
    prompt = await renderPrompt({
      issue,
      ...(settings.promptVariant !== undefined
        ? { variant: settings.promptVariant }
        : {}),
      ...(settings.promptsDirectory !== undefined
        ? { promptsDirectory: settings.promptsDirectory }
        : {})
    });
  } catch (cause) {
    return failureFromThrown("prompt_render", cause);
  }

  const writeArtifacts = dependencies.writeArtifacts ?? writePrepareArtifacts;
  let artifacts;
  try {
    artifacts = await writeArtifacts({
      issue,
      prompt,
      branchName: workspaceResult.value.branchName,
      worktreePath: workspaceResult.value.targetWorktreePath,
      beforeHead: headResult.value.head,
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
      issue,
      promptPath: artifacts.promptPath,
      issuePath: artifacts.issuePath,
      runPath: artifacts.runPath,
      branchName: workspaceResult.value.branchName,
      branch: workspaceResult.value.branchName,
      worktreePath: workspaceResult.value.targetWorktreePath,
      artifacts
    }
  };
}

export const prepareIssueWorkflow = runPrepareWorkflow;

function resolveSettings(
  options: PrepareWorkflowOptions
): PrepareWorkflowSettings {
  const settings = options.settings;

  return {
    baseRef: settings?.baseRef ?? options.baseRef,
    promptVariant:
      settings?.promptVariant ??
      settings?.variant ??
      options.promptVariant ??
      options.variant,
    promptsDirectory: settings?.promptsDirectory ?? options.promptsDirectory,
    runsDirectory: settings?.runsDirectory ?? options.runsDirectory
  };
}

function failureFromAutomationError(
  stage: PrepareWorkflowFailureStage,
  error: GitHubAutomationError | GitAutomationError
): PrepareWorkflowResult {
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
  stage: PrepareWorkflowFailureStage,
  cause: unknown
): PrepareWorkflowResult {
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
