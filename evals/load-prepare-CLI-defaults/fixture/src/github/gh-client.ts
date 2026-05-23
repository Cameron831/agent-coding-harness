import type { GitHubAutomationClient } from "./client.js";
import {
  LocalGhCommandRunner,
  type GhCommandResult,
  type GhCommandRunner
} from "./gh-runner.js";
import type {
  AutomationResult,
  GitHubAutomationError,
  IssueDetails,
  IssueIdentifier,
  IssueState,
  RepositorySelection
} from "./types.js";

const ISSUE_JSON_FIELDS = "number,title,state,url,body,labels,assignees";

interface GhIssueJson {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  url?: unknown;
  body?: unknown;
  labels?: unknown;
  assignees?: unknown;
}

export class GhGitHubAutomationClient implements GitHubAutomationClient {
  constructor(
    private readonly runner: GhCommandRunner = new LocalGhCommandRunner()
  ) {}

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

    const result = await this.runCommand(args);
    if (!result.ok) {
      return result;
    }

    try {
      return {
        ok: true,
        value: parseIssueDetails(result.value.stdout, input.repository)
      };
    } catch (cause) {
      return failure({
        code: "unknown",
        message: "Failed to parse gh issue JSON response.",
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

function validateIssueIdentifier(
  input: IssueIdentifier
): GitHubAutomationError | undefined {
  if (!Number.isInteger(input.issueNumber) || input.issueNumber <= 0) {
    return {
      code: "validation_failed",
      message: "Issue number must be a positive integer."
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
