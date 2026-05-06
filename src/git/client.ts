import type {
  CleanupWorktreeInput,
  CleanupWorktreeResult,
  CommitInput,
  CommitResult,
  CreateWorktreeInput,
  GitAutomationResult,
  PushBranchInput,
  PushBranchResult,
  StageFilesInput,
  StageFilesResult,
  WorktreeDetails
} from "./types.js";

export interface GitAutomationClient {
  createWorktree(
    input: CreateWorktreeInput
  ): Promise<GitAutomationResult<WorktreeDetails>>;
  stageFiles(input: StageFilesInput): Promise<GitAutomationResult<StageFilesResult>>;
  commit(input: CommitInput): Promise<GitAutomationResult<CommitResult>>;
  pushBranch(input: PushBranchInput): Promise<GitAutomationResult<PushBranchResult>>;
  cleanupWorktree(
    input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>>;
}
