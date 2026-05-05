import type {
  AutomationResult,
  CloseIssueInput,
  CreateIssueInput,
  CreatePullRequestInput,
  IssueDetails,
  IssueIdentifier,
  PullRequestDetails
} from "./types.js";

export interface GitHubAutomationClient {
  createIssue(input: CreateIssueInput): Promise<AutomationResult<IssueDetails>>;
  getIssue(input: IssueIdentifier): Promise<AutomationResult<IssueDetails>>;
  closeIssue(input: CloseIssueInput): Promise<AutomationResult<IssueDetails>>;
  createPullRequest(
    input: CreatePullRequestInput
  ): Promise<AutomationResult<PullRequestDetails>>;
}
