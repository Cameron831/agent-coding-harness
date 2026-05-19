import type { GitAutomationClient } from "../../git/client.js";
import { LocalGitAutomationClient } from "../../git/git-client.js";
import type {
  CleanupWorktreeResult,
  DeleteLocalBranchResult,
  GitAutomationError,
  GitAutomationErrorCode
} from "../../git/types.js";

export interface CleanupIssueWorkspaceOptions {
  issueNumber?: number;
  runPath: string;
  targetRepositoryPath: string;
  targetWorktreePath: string;
  branch: string;
}

export type CleanupIssueWorkspaceFailureStage =
  | "worktree_cleanup"
  | "branch_cleanup";

export interface CleanupIssueWorkspaceError {
  stage: CleanupIssueWorkspaceFailureStage;
  code: GitAutomationErrorCode | "unknown";
  message: string;
  cause?: unknown;
  worktreeCleanup?: CleanupWorktreeResult;
}

export interface CleanupIssueWorkspaceSuccess {
  issueNumber?: number;
  runPath: string;
  worktree: CleanupWorktreeResult;
  branch: DeleteLocalBranchResult;
}

export type CleanupIssueWorkspaceResult =
  | {
      ok: true;
      value: CleanupIssueWorkspaceSuccess;
    }
  | {
      ok: false;
      error: CleanupIssueWorkspaceError;
    };

export interface CleanupIssueWorkspaceDependencies {
  gitClient?: GitAutomationClient;
  createGitClient?: () => GitAutomationClient;
}

export async function runCleanupIssueWorkspaceWorkflow(
  options: CleanupIssueWorkspaceOptions,
  dependencies: CleanupIssueWorkspaceDependencies = {}
): Promise<CleanupIssueWorkspaceResult> {
  const gitClient =
    dependencies.gitClient ??
    dependencies.createGitClient?.() ??
    new LocalGitAutomationClient();

  let worktreeCleanup;
  try {
    worktreeCleanup = await gitClient.cleanupWorktree({
      targetRepositoryPath: options.targetRepositoryPath,
      targetWorktreePath: options.targetWorktreePath
    });
  } catch (cause) {
    return failureFromThrown("worktree_cleanup", cause);
  }

  if (!worktreeCleanup.ok) {
    return failureFromGitError("worktree_cleanup", worktreeCleanup.error);
  }

  let branchCleanup;
  try {
    branchCleanup = await gitClient.deleteLocalBranch({
      targetRepositoryPath: options.targetRepositoryPath,
      branchName: options.branch
    });
  } catch (cause) {
    return failureFromThrown(
      "branch_cleanup",
      cause,
      worktreeCleanup.value
    );
  }

  if (!branchCleanup.ok) {
    return failureFromGitError(
      "branch_cleanup",
      branchCleanup.error,
      worktreeCleanup.value
    );
  }

  return {
    ok: true,
    value: {
      ...(options.issueNumber !== undefined
        ? { issueNumber: options.issueNumber }
        : {}),
      runPath: options.runPath,
      worktree: worktreeCleanup.value,
      branch: branchCleanup.value
    }
  };
}

export const cleanupIssueWorkspaceWorkflow =
  runCleanupIssueWorkspaceWorkflow;

function failureFromGitError(
  stage: CleanupIssueWorkspaceFailureStage,
  error: GitAutomationError,
  worktreeCleanup?: CleanupWorktreeResult
): Extract<CleanupIssueWorkspaceResult, { ok: false }> {
  return {
    ok: false,
    error: {
      stage,
      code: error.code,
      message: error.message,
      ...(error.cause !== undefined ? { cause: error.cause } : {}),
      ...(worktreeCleanup !== undefined ? { worktreeCleanup } : {})
    }
  };
}

function failureFromThrown(
  stage: CleanupIssueWorkspaceFailureStage,
  cause: unknown,
  worktreeCleanup?: CleanupWorktreeResult
): Extract<CleanupIssueWorkspaceResult, { ok: false }> {
  return {
    ok: false,
    error: {
      stage,
      code: "unknown",
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
      ...(worktreeCleanup !== undefined ? { worktreeCleanup } : {})
    }
  };
}
