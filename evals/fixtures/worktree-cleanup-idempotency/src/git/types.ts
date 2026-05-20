export type GitAutomationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: GitAutomationError;
    };

export type GitAutomationErrorCode =
  | "validation_failed"
  | "unavailable"
  | "unknown";

export interface GitAutomationError {
  code: GitAutomationErrorCode;
  message: string;
  cause?: unknown;
}

export interface CleanupWorktreeInput {
  targetRepositoryPath: string;
  targetWorktreePath: string;
  force?: boolean;
}

export interface CleanupWorktreeResult {
  targetRepositoryPath: string;
  targetWorktreePath: string;
  removed: boolean;
}
