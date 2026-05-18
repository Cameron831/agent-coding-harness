import type {
  CleanupWorktreeInput,
  CleanupWorktreeResult,
  CommitInput,
  CommitResult,
  CreateWorktreeInput,
  GetChangedFilesInput,
  GetChangedFilesResult,
  GetDiffInput,
  GetDiffResult,
  GetHeadInput,
  GetHeadResult,
  GitAutomationResult,
  PushBranchInput,
  PushBranchResult,
  StageFilesInput,
  StageFilesResult,
  ValidateWorktreeInput,
  ValidateWorktreeResult,
  WorktreeDetails
} from "./types.js";

export interface GitAutomationClient {
  createWorktree(
    input: CreateWorktreeInput
  ): Promise<GitAutomationResult<WorktreeDetails>>;
  stageFiles(input: StageFilesInput): Promise<GitAutomationResult<StageFilesResult>>;
  getDiff(input: GetDiffInput): Promise<GitAutomationResult<GetDiffResult>>;
  getHead(input: GetHeadInput): Promise<GitAutomationResult<GetHeadResult>>;
  getChangedFiles(
    input: GetChangedFilesInput
  ): Promise<GitAutomationResult<GetChangedFilesResult>>;
  commit(input: CommitInput): Promise<GitAutomationResult<CommitResult>>;
  pushBranch(input: PushBranchInput): Promise<GitAutomationResult<PushBranchResult>>;
  cleanupWorktree(
    input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>>;
  validateWorktree(
    input: ValidateWorktreeInput
  ): Promise<GitAutomationResult<ValidateWorktreeResult>>;
}
