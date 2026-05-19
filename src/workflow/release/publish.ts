import path from "node:path";

import type { GitAutomationClient } from "../../git/client.js";
import { LocalGitAutomationClient } from "../../git/git-client.js";
import type {
  CheckRemoteBranchCommitResult,
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
  loadReleaseRunArtifact,
  updateRunStatus,
  writePullRequestRunArtifact,
  type PullRequestRunInput,
  type RunPathInput,
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
  | "run_validation"
  | "staging"
  | "commit"
  | "push"
  | "pr_creation"
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
  release?: ImplementorReleaseMetadata;
  changedFiles?: GetChangedFilesResult;
  staged?: StageFilesResult;
  commit?: ReleasePublishCommitResult;
  remoteBranch?: CheckRemoteBranchCommitResult;
  push?: ReleasePublishPushResult;
  pullRequest: ReleasePublishPullRequestResult;
  artifacts: ReleaseRunArtifactResult;
}

export interface ReleasePublishCommitResult extends CommitResult {
  reused: boolean;
}

export interface ReleasePublishPushResult extends PushBranchResult {
  reused: boolean;
}

export interface ReleasePublishPullRequestResult {
  repository?: RepositorySelection;
  pullRequestNumber?: number;
  title?: string;
  state?: PullRequestDetails["state"];
  url: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
  reused: boolean;
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

type ReleasePublishWorkflowFailure = Extract<
  ReleasePublishWorkflowResult,
  { ok: false }
>;

export interface ReleasePublishWorkflowDependencies {
  loadRelease?: (
    path: string
  ) => Promise<ReleaseJsonResult<ImplementorReleaseMetadata>>;
  loadRunArtifact?: (
    input: RunPathInput
  ) => Promise<Record<string, unknown>>;
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
  const runPath = options.runPath ?? path.join(path.dirname(options.releasePath), "run.json");
  const loadRun = dependencies.loadRunArtifact ?? loadReleaseRunArtifact;
  let existingRun: Record<string, unknown>;
  try {
    existingRun = await loadRun({ runPath });
  } catch (cause) {
    return failureFromThrown("run_validation", cause);
  }

  const targetWorktreePath = options.targetWorktreePath;
  const beforeHead = validateBeforeHead(existingRun, runPath);
  if (!beforeHead.ok) {
    return beforeHead;
  }

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

  let changedFiles;
  try {
    changedFiles = await gitClient.getChangedFiles({ targetWorktreePath });
  } catch (cause) {
    return failureFromThrown("staging", cause);
  }
  if (!changedFiles.ok) {
    return failureFromGitError("staging", changedFiles.error);
  }

  let head;
  try {
    head = await gitClient.getHead({ targetWorktreePath });
  } catch (cause) {
    return failureFromThrown("staging", cause);
  }
  if (!head.ok) {
    return failureFromGitError("staging", head.error);
  }

  let staged: StageFilesResult | undefined;
  let commit: ReleasePublishCommitResult;
  if (changedFiles.value.files.length > 0) {
    const stagedResult = await stageChangedFiles(
      gitClient,
      targetWorktreePath,
      changedFiles.value.files
    );
    if (!stagedResult.ok) {
      return stagedResult;
    }
    staged = stagedResult.value;

    const commitResult = await commitRelease(
      gitClient,
      targetWorktreePath,
      release.commit_message
    );
    if (!commitResult.ok) {
      return commitResult;
    }
    commit = commitResult.value;
  } else if (head.value.head !== beforeHead.value) {
    commit = {
      targetWorktreePath,
      commitSha: head.value.head,
      reused: true
    };
  } else {
    return {
      ok: false,
      error: {
        stage: "staging",
        code: "validation_failed",
        message:
          "No changed files to publish and current HEAD matches the recorded beforeHead."
      }
    };
  }

  const pushResult = await reconcilePush(gitClient, {
    targetWorktreePath,
    branchName: options.branch,
    expectedCommit: commit.commitSha
  });
  if (!pushResult.ok) {
    return pushResult;
  }

  const pullRequestResult = await reconcilePullRequest(
    githubClient,
    options,
    release
  );
  if (!pullRequestResult.ok) {
    return pullRequestResult;
  }

  const pullRequest = pullRequestResult.value;
  try {
    const writePullRequestRun =
      dependencies.writePullRequestRunArtifact ?? writePullRequestRunArtifact;
    await writePullRequestRun({
      runPath,
      pullRequestURL: pullRequest.url
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

  return {
    ok: true,
    value: {
      releasePath: options.releasePath,
      runPath,
      release,
      changedFiles: changedFiles.value,
      ...(staged !== undefined ? { staged } : {}),
      commit,
      remoteBranch: pushResult.value.remoteBranch,
      push: pushResult.value.push,
      pullRequest,
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

async function stageChangedFiles(
  gitClient: GitAutomationClient,
  targetWorktreePath: string,
  files: string[]
): Promise<
  | { ok: true; value: StageFilesResult }
  | { ok: false; error: ReleasePublishWorkflowError }
> {
  let staged;
  try {
    staged = await gitClient.stageFiles({ targetWorktreePath, files });
  } catch (cause) {
    return failureFromThrown("staging", cause);
  }
  if (!staged.ok) {
    return failureFromGitError("staging", staged.error);
  }

  return staged;
}

async function commitRelease(
  gitClient: GitAutomationClient,
  targetWorktreePath: string,
  message: string
): Promise<
  | { ok: true; value: ReleasePublishCommitResult }
  | { ok: false; error: ReleasePublishWorkflowError }
> {
  let commit;
  try {
    commit = await gitClient.commit({ targetWorktreePath, message });
  } catch (cause) {
    return failureFromThrown("commit", cause);
  }
  if (!commit.ok) {
    return failureFromGitError("commit", commit.error);
  }

  return {
    ok: true,
    value: {
      ...commit.value,
      reused: false
    }
  };
}

async function reconcilePush(
  gitClient: GitAutomationClient,
  input: {
    targetWorktreePath: string;
    branchName: string;
    expectedCommit: string;
  }
): Promise<
  | {
      ok: true;
      value: {
        remoteBranch: CheckRemoteBranchCommitResult;
        push: ReleasePublishPushResult;
      };
    }
  | { ok: false; error: ReleasePublishWorkflowError }
> {
  let remoteBranch;
  try {
    remoteBranch = await gitClient.checkRemoteBranchCommit(input);
  } catch (cause) {
    return failureFromThrown("push", cause);
  }
  if (!remoteBranch.ok) {
    return failureFromGitError("push", remoteBranch.error);
  }

  if (remoteBranch.value.status === "matches") {
    return {
      ok: true,
      value: {
        remoteBranch: remoteBranch.value,
        push: {
          targetWorktreePath: input.targetWorktreePath,
          branchName: remoteBranch.value.branchName,
          remoteName: remoteBranch.value.remoteName,
          reused: true
        }
      }
    };
  }

  let push;
  try {
    push = await gitClient.pushBranch({
      targetWorktreePath: input.targetWorktreePath,
      branchName: input.branchName,
      setUpstream: true
    });
  } catch (cause) {
    return failureFromThrown("push", cause);
  }
  if (!push.ok) {
    return failureFromGitError("push", push.error);
  }

  return {
    ok: true,
    value: {
      remoteBranch: remoteBranch.value,
      push: {
        ...push.value,
        reused: false
      }
    }
  };
}

async function reconcilePullRequest(
  githubClient: GitHubAutomationClient,
  options: ReleasePublishWorkflowOptions,
  release: ImplementorReleaseMetadata
): Promise<
  | { ok: true; value: ReleasePublishPullRequestResult }
  | { ok: false; error: ReleasePublishWorkflowError }
> {
  let pullRequests;
  try {
    pullRequests = await githubClient.listOpenPullRequests({
      repository: options.repository,
      head: options.branch,
      base: options.base
    });
  } catch (cause) {
    return failureFromThrown("pr_creation", cause);
  }
  if (!pullRequests.ok) {
    return failureFromGitHubError("pr_creation", pullRequests.error);
  }

  if (pullRequests.value.length > 1) {
    return {
      ok: false,
      error: {
        stage: "pr_creation",
        code: "validation_failed",
        message: `Multiple open pull requests match ${options.branch} into ${options.base}; cannot reconcile release publication.`
      }
    };
  }

  if (pullRequests.value.length === 1) {
    return {
      ok: true,
      value: {
        ...pullRequests.value[0],
        reused: true
      }
    };
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

  return {
    ok: true,
    value: {
      ...pullRequest.value,
      reused: false
    }
  };
}

function validateBeforeHead(
  run: Record<string, unknown>,
  runPath: string
): { ok: true; value: string } | { ok: false; error: ReleasePublishWorkflowError } {
  if (!isNonEmptyString(run.beforeHead)) {
    return {
      ok: false,
      error: {
        stage: "run_validation",
        code: "validation_failed",
        message: `Release run artifact at ${runPath} must include non-empty beforeHead before publishing.`
      }
    };
  }

  return {
    ok: true,
    value: run.beforeHead
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function failureFromGitError(
  stage: ReleasePublishWorkflowFailureStage,
  error: GitAutomationError
): ReleasePublishWorkflowFailure {
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
): ReleasePublishWorkflowFailure {
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
): ReleasePublishWorkflowFailure {
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
