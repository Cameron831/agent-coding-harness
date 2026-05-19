import type {
  CleanupWorktreeInput,
  CleanupWorktreeResult,
  DeleteLocalBranchInput,
  DeleteLocalBranchResult,
  CheckRemoteBranchCommitInput,
  CheckRemoteBranchCommitResult,
  CommitInput,
  CommitResult,
  CreateWorktreeInput,
  FetchRemoteTrackingRefInput,
  FetchRemoteTrackingRefResult,
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
  WorktreeDetails
} from "./types.js";

export interface GitAutomationClient {
  fetchRemoteTrackingRef(
    input: FetchRemoteTrackingRefInput
  ): Promise<GitAutomationResult<FetchRemoteTrackingRefResult>>;
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
  checkRemoteBranchCommit(
    input: CheckRemoteBranchCommitInput
  ): Promise<GitAutomationResult<CheckRemoteBranchCommitResult>>;
  pushBranch(input: PushBranchInput): Promise<GitAutomationResult<PushBranchResult>>;
  cleanupWorktree(
    input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>>;
  deleteLocalBranch(
    input: DeleteLocalBranchInput
  ): Promise<GitAutomationResult<DeleteLocalBranchResult>>;
}
