export interface RepositorySelection {
  owner: string;
  name: string;
  host?: string;
}

export type IssueState = "open" | "closed";

export type PullRequestState = "open" | "closed" | "merged";

export type AutomationErrorCode =
  | "not_found"
  | "permission_denied"
  | "validation_failed"
  | "unavailable"
  | "unknown";

export interface GitHubAutomationError {
  code: AutomationErrorCode;
  message: string;
  cause?: unknown;
}

export type AutomationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: GitHubAutomationError;
    };

export interface IssueIdentifier {
  repository: RepositorySelection;
  issueNumber: number;
}

export interface CreateIssueInput {
  repository: RepositorySelection;
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface CloseIssueInput extends IssueIdentifier {
  reason?: "completed" | "not_planned";
}

export interface IssueDetails extends IssueIdentifier {
  title: string;
  state: IssueState;
  url: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface PullRequestIdentifier {
  repository: RepositorySelection;
  pullRequestNumber: number;
}

export interface CreatePullRequestInput {
  repository: RepositorySelection;
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
  linkedIssueNumber?: number;
}

export interface PullRequestDetails extends PullRequestIdentifier {
  title: string;
  state: PullRequestState;
  url: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
}
