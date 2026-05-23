import type {
  CreateWorktreeInput,
  GetHeadInput,
  GetHeadResult,
  GitAutomationResult,
  WorktreeDetails
} from "./types.js";

export interface GitAutomationClient {
  createWorktree(
    input: CreateWorktreeInput
  ): Promise<GitAutomationResult<WorktreeDetails>>;
  getHead(input: GetHeadInput): Promise<GitAutomationResult<GetHeadResult>>;
}
