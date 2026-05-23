import type {
  AutomationResult,
  IssueDetails,
  IssueIdentifier
} from "./types.js";

export interface GitHubAutomationClient {
  getIssue(input: IssueIdentifier): Promise<AutomationResult<IssueDetails>>;
}
