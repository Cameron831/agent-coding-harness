import type {
  CleanupWorktreeInput,
  CleanupWorktreeResult,
  CommitInput,
  CommitResult,
  CreateWorktreeInput,
  GetDiffInput,
  GetDiffResult,
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
  getDiff(input: GetDiffInput): Promise<GitAutomationResult<GetDiffResult>>;
  commit(input: CommitInput): Promise<GitAutomationResult<CommitResult>>;
  pushBranch(input: PushBranchInput): Promise<GitAutomationResult<PushBranchResult>>;
  cleanupWorktree(
    input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>>;
}
