export type { GitAutomationClient } from "./git/client.js";
export { LocalGitAutomationClient } from "./git/git-client.js";
export { LocalGitCommandRunner } from "./git/git-runner.js";
export type {
  GitCommandResult,
  GitCommandRunner
} from "./git/git-runner.js";
export type {
  CleanupWorktreeInput,
  CleanupWorktreeResult,
  CheckRemoteBranchCommitInput,
  CheckRemoteBranchCommitResult,
  CommitInput,
  CommitResult,
  CreateWorktreeInput,
  DeleteLocalBranchInput,
  DeleteLocalBranchResult,
  FetchRemoteTrackingRefInput,
  FetchRemoteTrackingRefResult,
  GetChangedFilesInput,
  GetChangedFilesResult,
  GetDiffInput,
  GetDiffResult,
  GetHeadInput,
  GetHeadResult,
  GitAutomationError,
  GitAutomationErrorCode,
  GitAutomationResult,
  PushBranchInput,
  PushBranchResult,
  RemoteBranchCommitStatus,
  StageFilesInput,
  StageFilesResult,
  TargetRepositoryPath,
  TargetWorktreePath,
  WorktreeDetails
} from "./git/types.js";
