import path from "node:path";

import type { GitAutomationClient } from "../../git/client.js";
import { LocalGitAutomationClient } from "../../git/git-client.js";
import type {
  CleanupWorktreeResult,
  CommitResult,
  DeleteBranchResult,
  GetChangedFilesResult,
  GitAutomationError,
  GitAutomationErrorCode,
  PushBranchResult,
  StageFilesResult
} from "../../git/types.js";
import { GhGitHubAutomationClient } from "../../github/gh-client.js";
import type { GitHubAutomationClient } from "../../github/client.js";
import type {
  AutomationErrorCode,
  CreatePullRequestInput,
  GitHubAutomationError,
  PullRequestDetails,
  RepositorySelection
} from "../../github/types.js";
import {
  loadReleaseJson,
  renderReleasePullRequestInput,
  type ImplementorReleaseMetadata,
  type ReleaseJsonResult,
  type ReleaseValidationError
} from "../../parser/release.js";
import {
  updateRunStatus,
  writePullRequestRunArtifact,
  type PullRequestRunInput,
  type UpdateRunStatusInput,
  type ReleaseRunArtifactResult
} from "./artifact-writer.js";

export interface ReleasePublishWorkflowOptions {
  issueNumber?: number;
  releasePath: string;
  runPath?: string;
  targetWorktreePath: string;
  branch: string;
  targetRepositoryPath: string;
  repository?: RepositorySelection;
  base: string;
}

export type ReleasePublishWorkflowFailureStage =
  | "release_validation"
  | "staging"
  | "commit"
  | "push"
  | "pr_creation"
  | "cleanup"
  | "artifact_write";

export interface ReleasePublishWorkflowError {
  stage: ReleasePublishWorkflowFailureStage;
  code: GitAutomationErrorCode | AutomationErrorCode | "unknown";
  message: string;
  cause?: unknown;
  errors?: ReleaseValidationError[];
}

export interface ReleasePublishWorkflowSuccess {
  releasePath: string;
  runPath: string;
  release: ImplementorReleaseMetadata;
  changedFiles: GetChangedFilesResult;
  staged: StageFilesResult;
  commit: CommitResult;
  push: PushBranchResult;
  pullRequest: PullRequestDetails;
  cleanup: CleanupWorktreeResult;
  branchCleanup: DeleteBranchResult;
  artifacts: ReleaseRunArtifactResult;
}

export type ReleasePublishWorkflowResult =
  | {
      ok: true;
      value: ReleasePublishWorkflowSuccess;
    }
  | {
      ok: false;
      error: ReleasePublishWorkflowError;
    };

export interface ReleasePublishWorkflowDependencies {
  loadRelease?: (
    path: string
  ) => Promise<ReleaseJsonResult<ImplementorReleaseMetadata>>;
  updateRunStatus?: (
    input: UpdateRunStatusInput
  ) => Promise<ReleaseRunArtifactResult>;
  writePullRequestRunArtifact?: (
    input: PullRequestRunInput
  ) => Promise<ReleaseRunArtifactResult>;
  gitClient?: GitAutomationClient;
  githubClient?: GitHubAutomationClient;
  createGitClient?: () => GitAutomationClient;
  createGitHubClient?: () => GitHubAutomationClient;
}

export async function runReleasePublishWorkflow(
  options: ReleasePublishWorkflowOptions,
  dependencies: ReleasePublishWorkflowDependencies = {}
): Promise<ReleasePublishWorkflowResult> {
  const loadRelease = dependencies.loadRelease ?? loadReleaseJson;
  const releaseResult = await loadRelease(options.releasePath);
  if (!releaseResult.ok) {
    return {
      ok: false,
      error: {
        stage: "release_validation",
        code: "validation_failed",
        message: "Release metadata validation failed.",
        errors: releaseResult.errors
      }
    };
  }

  const runPath = options.runPath ?? path.join(path.dirname(options.releasePath), "run.json");
  const updateRunArtifactStatus = dependencies.updateRunStatus ?? updateRunStatus;
  try {
    await updateRunArtifactStatus({ runPath, status: "publishing" });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  const gitClient =
    dependencies.gitClient ??
    dependencies.createGitClient?.() ??
    new LocalGitAutomationClient();
  const githubClient =
    dependencies.githubClient ??
    dependencies.createGitHubClient?.() ??
    new GhGitHubAutomationClient();
  const release = releaseResult.value;
  const targetWorktreePath = options.targetWorktreePath;

  let changedFiles;
  try {
    changedFiles = await gitClient.getChangedFiles({ targetWorktreePath });
  } catch (cause) {
    return failureFromThrown("staging", cause);
  }
  if (!changedFiles.ok) {
    return failureFromGitError("staging", changedFiles.error);
  }
  if (changedFiles.value.files.length === 0) {
    return {
      ok: false,
      error: {
        stage: "staging",
        code: "validation_failed",
        message: "No changed files to publish."
      }
    };
  }

  let staged;
  try {
    staged = await gitClient.stageFiles({
      targetWorktreePath,
      files: changedFiles.value.files
    });
  } catch (cause) {
    return failureFromThrown("staging", cause);
  }
  if (!staged.ok) {
    return failureFromGitError("staging", staged.error);
  }

  let commit;
  try {
    commit = await gitClient.commit({
      targetWorktreePath,
      message: release.commit_message
    });
  } catch (cause) {
    return failureFromThrown("commit", cause);
  }
  if (!commit.ok) {
    return failureFromGitError("commit", commit.error);
  }

  let push;
  try {
    push = await gitClient.pushBranch({
      targetWorktreePath,
      branchName: options.branch,
      setUpstream: true
    });
  } catch (cause) {
    return failureFromThrown("push", cause);
  }
  if (!push.ok) {
    return failureFromGitError("push", push.error);
  }

  const pullRequestInput = buildPullRequestInput(options, release, options.branch);
  let pullRequest;
  try {
    pullRequest = await githubClient.createPullRequest(pullRequestInput);
  } catch (cause) {
    return failureFromThrown("pr_creation", cause);
  }
  if (!pullRequest.ok) {
    return failureFromGitHubError("pr_creation", pullRequest.error);
  }

  const writePullRequestRun =
    dependencies.writePullRequestRunArtifact ?? writePullRequestRunArtifact;
  try {
    await writePullRequestRun({
      runPath,
      pullRequestURL: pullRequest.value.url
    });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  let artifacts;
  try {
    artifacts = await updateRunArtifactStatus({ runPath, status: "published" });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
  }

  let cleanup;
  try {
    cleanup = await gitClient.cleanupWorktree({
      targetRepositoryPath: options.targetRepositoryPath,
      targetWorktreePath
    });
  } catch (cause) {
    return failureFromThrown("cleanup", cause);
  }
  if (!cleanup.ok) {
    return failureFromGitError("cleanup", cleanup.error);
  }

  let branchCleanup;
  try {
    branchCleanup = await gitClient.deleteBranch({
      targetRepositoryPath: options.targetRepositoryPath,
      branchName: options.branch
    });
  } catch (cause) {
    return failureFromThrown("cleanup", cause);
  }
  if (!branchCleanup.ok) {
    return failureFromGitError("cleanup", branchCleanup.error);
  }

  return {
    ok: true,
    value: {
      releasePath: options.releasePath,
      runPath,
      release,
      changedFiles: changedFiles.value,
      staged: staged.value,
      commit: commit.value,
      push: push.value,
      pullRequest: pullRequest.value,
      cleanup: cleanup.value,
      branchCleanup: branchCleanup.value,
      artifacts
    }
  };
}

export const releasePublishWorkflow = runReleasePublishWorkflow;

function buildPullRequestInput(
  options: ReleasePublishWorkflowOptions,
  release: ImplementorReleaseMetadata,
  head: string
): CreatePullRequestInput {
  const rendered = renderReleasePullRequestInput(release);
  return {
    repository: options.repository,
    title: rendered.title,
    body: rendered.body,
    base: options.base,
    head,
    ...(options.issueNumber !== undefined
      ? { linkedIssueNumber: options.issueNumber }
      : {})
  };
}

function failureFromGitError(
  stage: ReleasePublishWorkflowFailureStage,
  error: GitAutomationError
): ReleasePublishWorkflowResult {
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

function failureFromGitHubError(
  stage: ReleasePublishWorkflowFailureStage,
  error: GitHubAutomationError
): ReleasePublishWorkflowResult {
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
  stage: ReleasePublishWorkflowFailureStage,
  cause: unknown
): ReleasePublishWorkflowResult {
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
