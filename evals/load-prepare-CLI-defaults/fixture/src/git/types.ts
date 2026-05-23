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

export interface WorktreeDetails
  extends TargetRepositoryPath,
    TargetWorktreePath {
  branchName: string;
  baseRef?: string;
}

export interface GetHeadInput extends TargetWorktreePath {}

export interface GetHeadResult extends TargetWorktreePath {
  head: string;
}
