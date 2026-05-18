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
import type {
  GitAutomationError,
  GitAutomationResult,
  ValidateWorktreeInput,
  ValidateWorktreeResult
} from "../../git/types.js";
import {
  loadPrepareRunState,
  type PrepareArtifactWriterResult,
  type PrepareIssueArtifact,
  type PrepareRunArtifact,
  type LoadPrepareRunStateInput,
  type LoadPrepareRunStateResult,
  type UpdateRunArtifactInput,
  type UpdateRunArtifactResult,
  type WriteIssueArtifactInput,
  type WriteIssueArtifactResult,
  type WritePromptArtifactInput,
  type WritePromptArtifactResult,
  type WriteRunArtifactInput,
  type WriteRunArtifactResult,
  updateRunArtifact,
  writeIssueArtifact,
  writePromptArtifact,
  writeRunArtifact
} from "./artifact-writer.js";
import {
  renderImplementPrompt,
  type ImplementPromptVariant,
  type RenderImplementPromptInput
} from "../prompt-builder.js";
import {
  derivePrepareBranchName,
  derivePrepareWorktreePath,
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

export type PrepareIssueArtifactWriter = (
  input: WriteIssueArtifactInput
) => Promise<WriteIssueArtifactResult>;

export type PreparePromptArtifactWriter = (
  input: WritePromptArtifactInput
) => Promise<WritePromptArtifactResult>;

export type PrepareRunArtifactWriter = (
  input: WriteRunArtifactInput
) => Promise<WriteRunArtifactResult>;

export type PrepareRunArtifactUpdater = (
  input: UpdateRunArtifactInput
) => Promise<UpdateRunArtifactResult>;

export type PrepareRunStateLoader = (
  input: LoadPrepareRunStateInput
) => Promise<LoadPrepareRunStateResult>;

export interface PrepareWorkflowDependencies {
  githubClient?: GitHubAutomationClient;
  createGitHubClient?: () => GitHubAutomationClient;
  gitClient?: GitAutomationClient;
  loadRunState?: PrepareRunStateLoader;
  prepareWorkspace?: PrepareWorkspaceFunction;
  renderPrompt?: PreparePromptRenderer;
  writeIssueArtifact?: PrepareIssueArtifactWriter;
  writePromptArtifact?: PreparePromptArtifactWriter;
  writeRunArtifact?: PrepareRunArtifactWriter;
  updateRunArtifact?: PrepareRunArtifactUpdater;
}

export type PrepareWorkflowFailureStage =
  | "issue_fetch"
  | "workspace_prep"
  | "reconciliation"
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
  const gitClient = dependencies.gitClient ?? new LocalGitAutomationClient();
  const runStateLoader = dependencies.loadRunState ?? loadPrepareRunState;
  const runArtifactWriter = dependencies.writeRunArtifact ?? writeRunArtifact;
  const runArtifactUpdater = dependencies.updateRunArtifact ?? updateRunArtifact;
  const issueArtifactWriter =
    dependencies.writeIssueArtifact ?? writeIssueArtifact;
  const promptArtifactWriter =
    dependencies.writePromptArtifact ?? writePromptArtifact;

  let runState: LoadPrepareRunStateResult;
  try {
    runState = await runStateLoader({
      issueNumber: options.issueNumber,
      ...(settings.runsDirectory !== undefined
        ? { runsDirectory: settings.runsDirectory }
        : {})
    });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  const existingRun = runState.run;
  if (existingRun !== undefined) {
    const runValidationError = validateExistingPrepareRun(
      existingRun,
      options.issueNumber
    );
    if (runValidationError !== undefined) {
      return failureFromMessage("artifact_write", runValidationError);
    }

    const completeRun = getCompletePrepareRun(existingRun);
    if (completeRun !== undefined) {
      const validationResult = await validateReusableWorktree(gitClient, {
        targetRepositoryPath: options.targetRepositoryPath,
        targetWorktreePath: completeRun.worktreePath,
        expectedBranchName: completeRun.branch
      });
      if (!validationResult.ok) {
        return failureFromAutomationError(
          "workspace_prep",
          validationResult.error
        );
      }

      const issueResult = await fetchPrepareIssue(
        githubClient,
        options.repository,
        options.issueNumber
      );
      if (!issueResult.ok) {
        return issueResult;
      }

      const artifacts = buildPrepareArtifactsFromExistingRun(
        runState,
        issueResult.value,
        existingRun
      );
      return successFromArtifacts(
        issueResult.value,
        artifacts,
        completeRun.branch,
        completeRun.worktreePath
      );
    }
  }

  if (existingRun === undefined) {
    try {
      await runArtifactWriter({
        issueNumber: options.issueNumber,
        ...(settings.runsDirectory !== undefined
          ? { runsDirectory: settings.runsDirectory }
          : {})
      });
    } catch (cause) {
      return failureFromThrown("artifact_write", cause);
    }
  }

  const issueResult = await fetchPrepareIssue(
    githubClient,
    options.repository,
    options.issueNumber
  );
  if (!issueResult.ok) {
    return issueResult;
  }

  const issue = issueResult.value;
  const derivedBranchName = derivePrepareBranchName(
    issue.issueNumber,
    issue.title
  );
  if (derivedBranchName === undefined) {
    return failureFromMessage(
      "workspace_prep",
      "Issue title must contain at least one alphanumeric character."
    );
  }

  let issueArtifact: WriteIssueArtifactResult;
  let promptArtifact: WritePromptArtifactResult;
  try {
    issueArtifact = await writeIssueAndRunArtifacts(
      issueArtifactWriter,
      runArtifactUpdater,
      issue,
      settings
    );
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  const renderPrompt = dependencies.renderPrompt ?? renderImplementPrompt;
  try {
    promptArtifact = await renderAndWritePromptArtifact(
      renderPrompt,
      promptArtifactWriter,
      issue,
      settings
    );
  } catch (cause) {
    return failureFromThrown(
      cause instanceof PromptRenderError ? "prompt_render" : "artifact_write",
      cause instanceof PromptRenderError ? cause.cause : cause
    );
  }

  const prepareWorkspace = dependencies.prepareWorkspace ?? prepareIssueWorkspace;
  const workspaceResult = await resolvePrepareWorkspace({
    existingRun,
    gitClient,
    prepareWorkspace,
    issue,
    settings,
    options,
    derivedBranchName,
    updateRunArtifact: runArtifactUpdater
  });
  if (!workspaceResult.ok) {
    return workspaceResult;
  }

  let preparedRunArtifact: UpdateRunArtifactResult;
  try {
    preparedRunArtifact = await runArtifactUpdater({
      issueNumber: issue.issueNumber,
      ...(workspaceResult.value.shouldWriteWorktreePath
        ? { worktreePath: workspaceResult.value.targetWorktreePath }
        : {}),
      ...(workspaceResult.value.shouldWriteBranch
        ? { branchName: workspaceResult.value.branchName }
        : {}),
      ...(workspaceResult.value.shouldWriteBeforeHead
        ? { beforeHead: workspaceResult.value.beforeHead }
        : {}),
      status: "prepared",
      ...(settings.runsDirectory !== undefined
        ? { runsDirectory: settings.runsDirectory }
        : {})
    });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  const artifacts: PrepareArtifactWriterResult = {
    runDirectory: preparedRunArtifact.runDirectory,
    promptPath: promptArtifact.promptPath,
    issuePath: issueArtifact.issuePath,
    runPath: preparedRunArtifact.runPath,
    issue: issueArtifact.issue,
    run: preparedRunArtifact.run
  };

  return successFromArtifacts(
    issue,
    artifacts,
    workspaceResult.value.branchName,
    workspaceResult.value.targetWorktreePath
  );
}

export const prepareIssueWorkflow = runPrepareWorkflow;

interface CompletePrepareRun {
  status: string;
  issueURL: string;
  issueTitle: string;
  issueNumber: number;
  worktreePath: string;
  branch: string;
  beforeHead: string;
}

interface ResolvedPrepareWorkspace {
  branchName: string;
  targetWorktreePath: string;
  beforeHead: string;
  shouldWriteWorktreePath: boolean;
  shouldWriteBranch: boolean;
  shouldWriteBeforeHead: boolean;
}

type ResolvePrepareWorkspaceResult =
  | {
      ok: true;
      value: ResolvedPrepareWorkspace;
    }
  | {
      ok: false;
      error: PrepareWorkflowError;
    };

interface ResolvePrepareWorkspaceInput {
  existingRun?: PrepareRunArtifact;
  gitClient: GitAutomationClient;
  prepareWorkspace: PrepareWorkspaceFunction;
  issue: IssueDetails;
  settings: PrepareWorkflowSettings;
  options: PrepareWorkflowOptions;
  derivedBranchName: string;
  updateRunArtifact: PrepareRunArtifactUpdater;
}

type FetchPrepareIssueResult =
  | {
      ok: true;
      value: IssueDetails;
    }
  | {
      ok: false;
      error: PrepareWorkflowError;
    };

class PromptRenderError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

async function fetchPrepareIssue(
  githubClient: GitHubAutomationClient,
  repository: RepositorySelection | undefined,
  issueNumber: number
): Promise<FetchPrepareIssueResult> {
  let issueResult;
  try {
    issueResult = await githubClient.getIssue({
      repository,
      issueNumber
    });
  } catch (cause) {
    return failureFromThrown("issue_fetch", cause) as FetchPrepareIssueResult;
  }

  if (!issueResult.ok) {
    return failureFromAutomationError(
      "issue_fetch",
      issueResult.error
    ) as FetchPrepareIssueResult;
  }

  return issueResult;
}

async function writeIssueAndRunArtifacts(
  issueArtifactWriter: PrepareIssueArtifactWriter,
  runArtifactUpdater: PrepareRunArtifactUpdater,
  issue: IssueDetails,
  settings: PrepareWorkflowSettings
): Promise<WriteIssueArtifactResult> {
  const issueArtifact = await issueArtifactWriter({
    issue,
    ...(settings.runsDirectory !== undefined
      ? { runsDirectory: settings.runsDirectory }
      : {})
  });
  await runArtifactUpdater({
    issueNumber: issue.issueNumber,
    issue,
    ...(settings.runsDirectory !== undefined
      ? { runsDirectory: settings.runsDirectory }
      : {})
  });

  return issueArtifact;
}

async function renderAndWritePromptArtifact(
  renderPrompt: PreparePromptRenderer,
  promptArtifactWriter: PreparePromptArtifactWriter,
  issue: IssueDetails,
  settings: PrepareWorkflowSettings
): Promise<WritePromptArtifactResult> {
  let prompt: string;
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
    throw new PromptRenderError(cause);
  }

  return promptArtifactWriter({
    issueNumber: issue.issueNumber,
    prompt,
    ...(settings.runsDirectory !== undefined
      ? { runsDirectory: settings.runsDirectory }
      : {})
  });
}

async function resolvePrepareWorkspace(
  input: ResolvePrepareWorkspaceInput
): Promise<ResolvePrepareWorkspaceResult> {
  const existingRun = input.existingRun;
  const recordedWorktreePath = existingRun?.worktreePath;
  if (existingRun !== undefined && isNonEmptyString(recordedWorktreePath)) {
    const validationResult = await validateReusableWorktree(input.gitClient, {
      targetRepositoryPath: input.options.targetRepositoryPath,
      targetWorktreePath: recordedWorktreePath,
      ...(isNonEmptyString(existingRun.branch)
        ? { expectedBranchName: existingRun.branch }
        : {})
    });
    if (!validationResult.ok) {
      return failureFromAutomationError(
        "workspace_prep",
        validationResult.error
      ) as ResolvePrepareWorkspaceResult;
    }

    return {
      ok: true,
      value: {
        branchName: validationResult.value.branchName,
        targetWorktreePath: recordedWorktreePath,
        beforeHead: isNonEmptyString(existingRun.beforeHead)
          ? existingRun.beforeHead
          : validationResult.value.head,
        shouldWriteWorktreePath: false,
        shouldWriteBranch: !isNonEmptyString(existingRun.branch),
        shouldWriteBeforeHead: !isNonEmptyString(existingRun.beforeHead)
      }
    };
  }

  if (existingRun !== undefined) {
    if (
      isNonEmptyString(existingRun.branch) &&
      existingRun.branch !== input.derivedBranchName
    ) {
      return failureFromMessage(
        "reconciliation",
        `Existing prepare run artifact branch ${existingRun.branch} does not match derived branch ${input.derivedBranchName}.`
      ) as ResolvePrepareWorkspaceResult;
    }

    const derivedWorktreePath = derivePrepareWorktreePath(
      input.options.worktreeParentPath,
      input.issue.issueNumber
    );
    const validationResult = await validateReusableWorktree(input.gitClient, {
      targetRepositoryPath: input.options.targetRepositoryPath,
      targetWorktreePath: derivedWorktreePath,
      expectedBranchName: input.derivedBranchName
    });

    if (validationResult.ok) {
      return {
        ok: true,
        value: {
          branchName: validationResult.value.branchName,
          targetWorktreePath: derivedWorktreePath,
          beforeHead: isNonEmptyString(existingRun.beforeHead)
            ? existingRun.beforeHead
            : validationResult.value.head,
          shouldWriteWorktreePath: true,
          shouldWriteBranch: !isNonEmptyString(existingRun.branch),
          shouldWriteBeforeHead: !isNonEmptyString(existingRun.beforeHead)
        }
      };
    }

    if (!isUnassociatedWorktreeFailure(validationResult.error)) {
      return failureFromAutomationError(
        "workspace_prep",
        validationResult.error
      ) as ResolvePrepareWorkspaceResult;
    }
  }

  let workspaceResult;
  try {
    workspaceResult = await input.prepareWorkspace(
      {
        issueNumber: input.issue.issueNumber,
        issueTitle: input.issue.title,
        targetRepositoryPath: input.options.targetRepositoryPath,
        worktreeParentPath: input.options.worktreeParentPath,
        ...(input.settings.baseRef !== undefined
          ? { baseRef: input.settings.baseRef }
          : {})
      },
      { gitClient: input.gitClient }
    );
  } catch (cause) {
    return failureFromThrown(
      "workspace_prep",
      cause
    ) as ResolvePrepareWorkspaceResult;
  }

  if (!workspaceResult.ok) {
    return failureFromAutomationError(
      "workspace_prep",
      workspaceResult.error
    ) as ResolvePrepareWorkspaceResult;
  }

  try {
    await input.updateRunArtifact({
      issueNumber: input.issue.issueNumber,
      worktreePath: workspaceResult.value.targetWorktreePath,
      branchName: workspaceResult.value.branchName,
      ...(input.settings.runsDirectory !== undefined
        ? { runsDirectory: input.settings.runsDirectory }
        : {})
    });
  } catch (cause) {
    return failureFromThrown(
      "artifact_write",
      cause
    ) as ResolvePrepareWorkspaceResult;
  }

  let headResult;
  try {
    headResult = await input.gitClient.getHead({
      targetWorktreePath: workspaceResult.value.targetWorktreePath
    });
  } catch (cause) {
    return failureFromThrown(
      "workspace_prep",
      cause
    ) as ResolvePrepareWorkspaceResult;
  }

  if (!headResult.ok) {
    return failureFromAutomationError(
      "workspace_prep",
      headResult.error
    ) as ResolvePrepareWorkspaceResult;
  }

  return {
    ok: true,
    value: {
      branchName: workspaceResult.value.branchName,
      targetWorktreePath: workspaceResult.value.targetWorktreePath,
      beforeHead: headResult.value.head,
      shouldWriteWorktreePath: false,
      shouldWriteBranch: false,
      shouldWriteBeforeHead: true
    }
  };
}

async function validateReusableWorktree(
  gitClient: GitAutomationClient,
  input: ValidateWorktreeInput
): Promise<GitAutomationResult<ValidateWorktreeResult>> {
  return gitClient.validateWorktree(input);
}

function validateExistingPrepareRun(
  run: PrepareRunArtifact,
  issueNumber: number
): string | undefined {
  if (
    run.status !== undefined &&
    (!isNonEmptyString(run.status) || !isPrepareRunStatus(run.status))
  ) {
    return "Existing prepare run artifact status must be a known prepare run status.";
  }

  if (run.issueNumber !== undefined) {
    if (!Number.isInteger(run.issueNumber)) {
      return "Existing prepare run artifact issueNumber must be an integer.";
    }

    if (run.issueNumber !== issueNumber) {
      return `Existing prepare run artifact issueNumber ${run.issueNumber} does not match requested issue ${issueNumber}.`;
    }
  }

  for (const field of ["issueURL", "issueTitle", "worktreePath", "branch", "beforeHead"]) {
    const value = run[field];
    if (value !== undefined && !isNonEmptyString(value)) {
      return `Existing prepare run artifact ${field} must be a non-empty string.`;
    }
  }

  return undefined;
}

function getCompletePrepareRun(
  run: PrepareRunArtifact
): CompletePrepareRun | undefined {
  if (
    !isPrepareRunStatus(run.status) ||
    !isNonEmptyString(run.issueURL) ||
    !isNonEmptyString(run.issueTitle) ||
    typeof run.issueNumber !== "number" ||
    !Number.isInteger(run.issueNumber) ||
    !isNonEmptyString(run.worktreePath) ||
    !isNonEmptyString(run.branch) ||
    !isNonEmptyString(run.beforeHead)
  ) {
    return undefined;
  }

  return {
    status: run.status,
    issueURL: run.issueURL,
    issueTitle: run.issueTitle,
    issueNumber: run.issueNumber,
    worktreePath: run.worktreePath,
    branch: run.branch,
    beforeHead: run.beforeHead
  };
}

function buildPrepareArtifactsFromExistingRun(
  runState: LoadPrepareRunStateResult,
  issue: IssueDetails,
  run: PrepareRunArtifact
): PrepareArtifactWriterResult {
  return {
    runDirectory: runState.paths.runDirectory,
    promptPath: runState.paths.promptPath,
    issuePath: runState.paths.issuePath,
    runPath: runState.paths.runPath,
    issue: buildIssueArtifact(issue),
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

function successFromArtifacts(
  issue: IssueDetails,
  artifacts: PrepareArtifactWriterResult,
  branchName: string,
  worktreePath: string
): PrepareWorkflowResult {
  return {
    ok: true,
    value: {
      issue,
      promptPath: artifacts.promptPath,
      issuePath: artifacts.issuePath,
      runPath: artifacts.runPath,
      branchName,
      branch: branchName,
      worktreePath,
      artifacts
    }
  };
}

function isPrepareRunStatus(value: unknown): value is PrepareRunArtifact["status"] {
  return (
    value === "preparing" ||
    value === "prepared" ||
    value === "implementing" ||
    value === "needsFeedback" ||
    value === "approvedPublishing" ||
    value === "publishing" ||
    value === "published"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isUnassociatedWorktreeFailure(error: GitAutomationError): boolean {
  return (
    error.code === "validation_failed" &&
    error.message ===
      "Target worktree path is not associated with the target repository."
  );
}

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

function failureFromMessage(
  stage: PrepareWorkflowFailureStage,
  message: string
): PrepareWorkflowResult {
  return {
    ok: false,
    error: {
      stage,
      code: "validation_failed",
      message
    }
  };
}
