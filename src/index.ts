export type { GitHubAutomationClient } from "./github/client.js";
export { GhGitHubAutomationClient } from "./github/gh-client.js";
export { LocalGhCommandRunner } from "./github/gh-runner.js";
export type {
  GhCommandResult,
  GhCommandRunner
} from "./github/gh-runner.js";
export type {
  AutomationErrorCode,
  AutomationResult,
  CloseIssueInput,
  CreateIssueInput,
  CreatePullRequestInput,
  GitHubAutomationError,
  IssueDetails,
  IssueIdentifier,
  IssueState,
  PullRequestDetails,
  PullRequestIdentifier,
  PullRequestState,
  RepositorySelection
} from "./github/types.js";
