import type { GitHubAutomationClient } from "./client.js";
import {
  LocalGhCommandRunner,
  type GhCommandResult,
  type GhCommandRunner
} from "./gh-runner.js";
import type {
  AutomationResult,
  CloseIssueInput,
  CreateIssueInput,
  CreatePullRequestInput,
  GitHubAutomationError,
  IssueDetails,
  IssueIdentifier,
  IssueState,
  PullRequestDetails,
  PullRequestState,
  RepositorySelection
} from "./types.js";

const ISSUE_JSON_FIELDS = "number,title,state,url,body,labels,assignees";
const PULL_REQUEST_JSON_FIELDS =
  "number,title,state,url,body,headRefName,baseRefName,isDraft";

interface GhIssueJson {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  url?: unknown;
  body?: unknown;
  labels?: unknown;
  assignees?: unknown;
}

interface GhPullRequestJson {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  url?: unknown;
  body?: unknown;
  headRefName?: unknown;
  baseRefName?: unknown;
  isDraft?: unknown;
}

export class GhGitHubAutomationClient implements GitHubAutomationClient {
  constructor(
    private readonly runner: GhCommandRunner = new LocalGhCommandRunner()
  ) {}

  async createIssue(
    input: CreateIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    const validationError = validateCreateIssueInput(input);
    if (validationError) {
      return failure(validationError);
    }

    const args = ["issue", "create", "--title", input.title];
    if (input.body !== undefined) {
      args.push("--body", input.body);
    }
    appendRepeatedArgs(args, "--label", input.labels);
    appendRepeatedArgs(args, "--assignee", input.assignees);
    appendRepositoryArgs(args, input.repository);

    const createResult = await this.runCommand(args);
    if (!createResult.ok) {
      return createResult;
    }

    const issueNumberResult = parseCreatedIssueNumber(createResult.value.stdout);
    if (!issueNumberResult.ok) {
      return issueNumberResult;
    }

    return this.viewIssue(issueNumberResult.value, input.repository);
  }

  async getIssue(
    input: IssueIdentifier
  ): Promise<AutomationResult<IssueDetails>> {
    const validationError = validateIssueIdentifier(input);
    if (validationError) {
      return failure(validationError);
    }

    const args = [
      "issue",
      "view",
      String(input.issueNumber),
      "--json",
      ISSUE_JSON_FIELDS
    ];
    appendRepositoryArgs(args, input.repository);

    return this.runIssueViewCommand(args, input.repository);
  }

  async closeIssue(
    input: CloseIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    const validationError = validateIssueIdentifier(input);
    if (validationError) {
      return failure(validationError);
    }

    const args = [
      "issue",
      "close",
      String(input.issueNumber)
    ];
    if (input.reason !== undefined) {
      args.push("--reason", input.reason);
    }
    appendRepositoryArgs(args, input.repository);

    const closeResult = await this.runCommand(args);
    if (!closeResult.ok) {
      return closeResult;
    }

    return this.viewIssue(input.issueNumber, input.repository);
  }

  async createPullRequest(
    input: CreatePullRequestInput
  ): Promise<AutomationResult<PullRequestDetails>> {
    const validationError = validateCreatePullRequestInput(input);
    if (validationError) {
      return failure(validationError);
    }

    const args = [
      "pr",
      "create",
      "--title",
      input.title,
      "--head",
      input.head,
      "--base",
      input.base
    ];
    const body = buildPullRequestBody(input.body, input.linkedIssueNumber);
    if (body !== undefined) {
      args.push("--body", body);
    }
    if (input.draft === true) {
      args.push("--draft");
    }
    appendRepositoryArgs(args, input.repository);

    const createResult = await this.runCommand(args);
    if (!createResult.ok) {
      return createResult;
    }

    const pullRequestNumberResult = parseCreatedPullRequestNumber(
      createResult.value.stdout
    );
    if (!pullRequestNumberResult.ok) {
      return pullRequestNumberResult;
    }

    return this.viewPullRequest(
      pullRequestNumberResult.value,
      input.repository
    );
  }

  private viewIssue(
    issueNumber: number,
    repository: RepositorySelection | undefined
  ): Promise<AutomationResult<IssueDetails>> {
    const args = [
      "issue",
      "view",
      String(issueNumber),
      "--json",
      ISSUE_JSON_FIELDS
    ];
    appendRepositoryArgs(args, repository);

    return this.runIssueViewCommand(args, repository);
  }

  private async runIssueViewCommand(
    args: readonly string[],
    repository: RepositorySelection | undefined
  ): Promise<AutomationResult<IssueDetails>> {
    const result = await this.runCommand(args);
    if (!result.ok) {
      return result;
    }

    try {
      return { ok: true, value: parseIssueDetails(result.value.stdout, repository) };
    } catch (cause) {
      return failure({
        code: "unknown",
        message: "Failed to parse gh issue JSON response.",
        cause
      });
    }
  }

  private async viewPullRequest(
    pullRequestNumber: number,
    repository: RepositorySelection | undefined
  ): Promise<AutomationResult<PullRequestDetails>> {
    const args = [
      "pr",
      "view",
      String(pullRequestNumber),
      "--json",
      PULL_REQUEST_JSON_FIELDS
    ];
    appendRepositoryArgs(args, repository);

    const result = await this.runCommand(args);
    if (!result.ok) {
      return result;
    }

    try {
      return {
        ok: true,
        value: parsePullRequestDetails(result.value.stdout, repository)
      };
    } catch (cause) {
      return failure({
        code: "unknown",
        message: "Failed to parse gh pull request JSON response.",
        cause
      });
    }
  }

  private async runCommand(
    args: readonly string[]
  ): Promise<AutomationResult<GhCommandResult>> {
    let result;
    try {
      result = await this.runner.run(args);
    } catch (cause) {
      return failure({
        code: "unavailable",
        message: "Failed to run gh.",
        cause
      });
    }

    if (result.exitCode !== 0) {
      return failure({
        code: "unknown",
        message: result.stderr.trim() || `gh exited with code ${result.exitCode}.`,
        cause: result
      });
    }

    return { ok: true, value: result };
  }
}

function validateCreateIssueInput(
  input: CreateIssueInput
): GitHubAutomationError | undefined {
  if (input.title.trim() === "") {
    return {
      code: "validation_failed",
      message: "Issue title is required."
    };
  }

  return (
    validateNonEmptyArrayValues(input.labels, "Issue labels") ??
    validateNonEmptyArrayValues(input.assignees, "Issue assignees") ??
    validateRepository(input.repository)
  );
}

function validateIssueIdentifier(
  input: CloseIssueInput
): GitHubAutomationError | undefined {
  if (!Number.isInteger(input.issueNumber) || input.issueNumber <= 0) {
    return {
      code: "validation_failed",
      message: "Issue number must be a positive integer."
    };
  }

  return validateRepository(input.repository);
}

function validateCreatePullRequestInput(
  input: CreatePullRequestInput
): GitHubAutomationError | undefined {
  if (input.title.trim() === "") {
    return {
      code: "validation_failed",
      message: "Pull request title is required."
    };
  }

  if (input.head.trim() === "") {
    return {
      code: "validation_failed",
      message: "Pull request head branch is required."
    };
  }

  if (input.base.trim() === "") {
    return {
      code: "validation_failed",
      message: "Pull request base branch is required."
    };
  }

  if (
    input.linkedIssueNumber !== undefined &&
    (!Number.isInteger(input.linkedIssueNumber) || input.linkedIssueNumber <= 0)
  ) {
    return {
      code: "validation_failed",
      message: "Linked issue number must be a positive integer."
    };
  }

  return validateRepository(input.repository);
}

function validateRepository(
  repository: RepositorySelection | undefined
): GitHubAutomationError | undefined {
  if (
    repository &&
    (repository.owner.trim() === "" || repository.name.trim() === "")
  ) {
    return {
      code: "validation_failed",
      message: "Repository owner and name are required when repository is supplied."
    };
  }

  return undefined;
}

function appendRepositoryArgs(
  args: string[],
  repository: RepositorySelection | undefined
): void {
  if (repository) {
    args.push("--repo", `${repository.owner}/${repository.name}`);
  }
}

function appendRepeatedArgs(
  args: string[],
  flag: string,
  values: readonly string[] | undefined
): void {
  for (const value of values ?? []) {
    args.push(flag, value);
  }
}

function validateNonEmptyArrayValues(
  values: readonly string[] | undefined,
  fieldName: string
): GitHubAutomationError | undefined {
  if (values?.some((value) => value.trim() === "")) {
    return {
      code: "validation_failed",
      message: `${fieldName} must be non-empty strings when supplied.`
    };
  }

  return undefined;
}

function parseIssueDetails(
  stdout: string,
  repository: RepositorySelection | undefined
): IssueDetails {
  const parsed = JSON.parse(stdout) as GhIssueJson;
  const state = normalizeIssueState(parsed.state);

  if (
    typeof parsed.number !== "number" ||
    typeof parsed.title !== "string" ||
    state === undefined ||
    typeof parsed.url !== "string" ||
    (parsed.body !== undefined && typeof parsed.body !== "string") ||
    !isNamedGhArray(parsed.labels, "name") ||
    !isNamedGhArray(parsed.assignees, "login")
  ) {
    throw new Error("Unexpected gh issue JSON shape.");
  }

  return {
    repository,
    issueNumber: parsed.number,
    title: parsed.title,
    state,
    url: parsed.url,
    body: parsed.body,
    labels: parsed.labels.map((label) => label.name),
    assignees: parsed.assignees.map((assignee) => assignee.login)
  };
}

function parsePullRequestDetails(
  stdout: string,
  repository: RepositorySelection | undefined
): PullRequestDetails {
  const parsed = JSON.parse(stdout) as GhPullRequestJson;
  const state = normalizePullRequestState(parsed.state);

  if (
    typeof parsed.number !== "number" ||
    typeof parsed.title !== "string" ||
    state === undefined ||
    typeof parsed.url !== "string" ||
    (parsed.body !== undefined && typeof parsed.body !== "string") ||
    typeof parsed.headRefName !== "string" ||
    typeof parsed.baseRefName !== "string" ||
    (parsed.isDraft !== undefined && typeof parsed.isDraft !== "boolean")
  ) {
    throw new Error("Unexpected gh pull request JSON shape.");
  }

  return {
    repository,
    pullRequestNumber: parsed.number,
    title: parsed.title,
    state,
    url: parsed.url,
    body: parsed.body,
    head: parsed.headRefName,
    base: parsed.baseRefName,
    draft: parsed.isDraft
  };
}

function parseCreatedIssueNumber(stdout: string): AutomationResult<number> {
  const match = stdout.match(/\/issues\/(\d+)\b/);
  if (!match) {
    return failure({
      code: "unknown",
      message: "Failed to parse created issue number from gh output."
    });
  }

  return { ok: true, value: Number(match[1]) };
}

function parseCreatedPullRequestNumber(stdout: string): AutomationResult<number> {
  const match = stdout.match(/\/pull\/(\d+)\b/);
  if (!match) {
    return failure({
      code: "unknown",
      message: "Failed to parse created pull request number from gh output."
    });
  }

  return { ok: true, value: Number(match[1]) };
}

function buildPullRequestBody(
  body: string | undefined,
  linkedIssueNumber: number | undefined
): string | undefined {
  if (linkedIssueNumber === undefined) {
    return body;
  }

  if (bodyHasClosingReference(body, linkedIssueNumber)) {
    return body;
  }

  const closingReference = `Closes #${linkedIssueNumber}`;
  if (body === undefined || body.trim() === "") {
    return closingReference;
  }

  return `${body.trimEnd()}\n\n${closingReference}`;
}

function bodyHasClosingReference(
  body: string | undefined,
  issueNumber: number
): boolean {
  if (body === undefined) {
    return false;
  }

  const pattern = new RegExp(
    String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#${issueNumber}\b`,
    "i"
  );
  return pattern.test(body);
}

function isIssueState(value: unknown): value is IssueState {
  return value === "open" || value === "closed";
}

function normalizeIssueState(value: unknown): IssueState | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.toLowerCase();
  return isIssueState(normalized) ? normalized : undefined;
}

function normalizePullRequestState(
  value: unknown
): PullRequestState | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (
    normalized === "open" ||
    normalized === "closed" ||
    normalized === "merged"
  ) {
    return normalized;
  }

  return undefined;
}

function isNamedGhArray<T extends string>(
  value: unknown,
  property: T
): value is Array<Record<T, string>> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<T, unknown>)[property] === "string"
    )
  );
}

function failure<T>(error: GitHubAutomationError): AutomationResult<T> {
  return { ok: false, error };
}
