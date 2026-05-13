import path from "node:path";

import type { GitAutomationClient } from "../../git/client.js";
import { LocalGitAutomationClient } from "../../git/git-client.js";
import type {
  CleanupWorktreeResult,
  CommitResult,
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
  writeReleasePublishedRunArtifact,
  writeReleasePublishingRunArtifact,
  type ReleaseRunArtifactResult
} from "./artifact-writer.js";

export interface ReleasePublishWorkflowOptions {
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
  writePublishingRunArtifact?: (
    input: { runPath: string }
  ) => Promise<ReleaseRunArtifactResult>;
  writePublishedRunArtifact?: (
    input: { runPath: string; pullRequestURL: string }
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
  const writePublishingRunArtifact =
    dependencies.writePublishingRunArtifact ?? writeReleasePublishingRunArtifact;
  try {
    await writePublishingRunArtifact({ runPath });
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

  const writePublishedRunArtifact =
    dependencies.writePublishedRunArtifact ?? writeReleasePublishedRunArtifact;
  let artifacts;
  try {
    artifacts = await writePublishedRunArtifact({
      runPath,
      pullRequestURL: pullRequest.value.url
    });
  } catch (cause) {
    return failureFromThrown("artifact_write", cause);
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
    head
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
