import type { AutomationResult } from "../github/types.js";

export type GitAutomationResult<T> = AutomationResult<T>;

export type GitAutomationErrorCode =
  | "not_found"
  | "permission_denied"
  | "validation_failed"
  | "unavailable"
  | "unknown";

export interface GitAutomationError {
  code: GitAutomationErrorCode;
  message: string;
  cause?: unknown;
}

export interface TargetRepositoryPath {
  targetRepositoryPath: string;
}

export interface TargetWorktreePath {
  targetWorktreePath: string;
}

export interface CreateWorktreeInput extends TargetRepositoryPath {
  targetWorktreePath: string;
  branchName: string;
  baseRef?: string;
}

export interface WorktreeDetails extends TargetRepositoryPath, TargetWorktreePath {
  branchName: string;
  baseRef?: string;
}

export interface StageFilesInput extends TargetWorktreePath {
  files: string[];
}

export interface StageFilesResult extends TargetWorktreePath {
  files: string[];
}

export interface GetDiffInput extends TargetWorktreePath {}

export interface GetDiffResult extends TargetWorktreePath {
  diff: string;
}

export interface GetHeadInput extends TargetWorktreePath {}

export interface GetHeadResult extends TargetWorktreePath {
  head: string;
}

export interface GetChangedFilesInput extends TargetWorktreePath {}

export interface GetChangedFilesResult extends TargetWorktreePath {
  files: string[];
}

export interface CommitInput extends TargetWorktreePath {
  message: string;
}

export interface CommitResult extends TargetWorktreePath {
  commitSha: string;
}

export interface PushBranchInput extends TargetWorktreePath {
  branchName: string;
  remoteName?: string;
  setUpstream?: boolean;
}

export interface PushBranchResult extends TargetWorktreePath {
  branchName: string;
  remoteName: string;
}

export type RemoteBranchCommitStatus = "matches" | "missing" | "different";

export interface CheckRemoteBranchCommitInput extends TargetWorktreePath {
  branchName: string;
  remoteName?: string;
  expectedCommit: string;
}

export interface CheckRemoteBranchCommitResult extends TargetWorktreePath {
  branchName: string;
  remoteName: string;
  expectedCommit: string;
  status: RemoteBranchCommitStatus;
  actualCommit?: string;
}

export interface CleanupWorktreeInput extends TargetRepositoryPath, TargetWorktreePath {
  force?: boolean;
}

export interface CleanupWorktreeResult extends TargetRepositoryPath, TargetWorktreePath {
  removed: boolean;
}

export interface DeleteBranchInput extends TargetRepositoryPath {
  branchName: string;
}

export interface DeleteBranchResult extends TargetRepositoryPath {
  branchName: string;
}
