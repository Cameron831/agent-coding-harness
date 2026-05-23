import type { GitAutomationClient } from "../../git/client.js";
import { LocalGitAutomationClient } from "../../git/git-client.js";
import type {
  GitAutomationError,
  GitAutomationResult
} from "../../git/types.js";

export interface PrepareIssueWorkspaceInput {
  issueNumber: number;
  issueTitle: string;
  targetRepositoryPath: string;
  worktreeParentPath: string;
  baseRef?: string;
}

export interface PrepareIssueWorkspaceDependencies {
  gitClient?: GitAutomationClient;
}

export interface PreparedIssueWorkspace {
  branchName: string;
  targetWorktreePath: string;
}

export type PrepareIssueWorkspaceResult =
  GitAutomationResult<PreparedIssueWorkspace>;

export async function prepareIssueWorkspace(
  input: PrepareIssueWorkspaceInput,
  dependencies: PrepareIssueWorkspaceDependencies = {}
): Promise<PrepareIssueWorkspaceResult> {
  const validationError = validateInput(input);
  if (validationError) {
    return failure(validationError);
  }

  const slug = normalizeIssueTitleSlug(input.issueTitle);
  if (slug === "") {
    return failure({
      code: "validation_failed",
      message: "Issue title must contain at least one alphanumeric character."
    });
  }

  const branchName = `${input.issueNumber}-${slug}`;
  const targetWorktreePath = joinWorktreePath(
    input.worktreeParentPath,
    `issue-${input.issueNumber}`
  );
  const gitClient = dependencies.gitClient ?? new LocalGitAutomationClient();

  const result = await gitClient.createWorktree({
    targetRepositoryPath: input.targetRepositoryPath,
    branchName,
    targetWorktreePath,
    ...(input.baseRef !== undefined ? { baseRef: input.baseRef } : {})
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    value: {
      branchName,
      targetWorktreePath
    }
  };
}

function validateInput(
  input: PrepareIssueWorkspaceInput
): GitAutomationError | undefined {
  if (!Number.isInteger(input.issueNumber) || input.issueNumber <= 0) {
    return {
      code: "validation_failed",
      message: "Issue number must be a positive integer."
    };
  }

  if (typeof input.issueTitle !== "string" || input.issueTitle.trim() === "") {
    return {
      code: "validation_failed",
      message: "Issue title is required."
    };
  }

  if (
    typeof input.targetRepositoryPath !== "string" ||
    input.targetRepositoryPath.trim() === ""
  ) {
    return {
      code: "validation_failed",
      message: "Target repository path is required."
    };
  }

  if (
    typeof input.worktreeParentPath !== "string" ||
    input.worktreeParentPath.trim() === ""
  ) {
    return {
      code: "validation_failed",
      message: "Worktree parent path is required."
    };
  }

  if (
    input.baseRef !== undefined &&
    (typeof input.baseRef !== "string" || input.baseRef.trim() === "")
  ) {
    return {
      code: "validation_failed",
      message: "Base ref must be non-empty when supplied."
    };
  }

  return undefined;
}

function normalizeIssueTitleSlug(issueTitle: string): string {
  return issueTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function joinWorktreePath(parentPath: string, childPath: string): string {
  const separator =
    parentPath.includes("\\") && !parentPath.includes("/") ? "\\" : "/";
  const trimmedParentPath = parentPath.replace(/[\\/]+$/g, "");

  return trimmedParentPath === ""
    ? `${separator}${childPath}`
    : `${trimmedParentPath}${separator}${childPath}`;
}

function failure<T>(error: GitAutomationError): GitAutomationResult<T> {
  return { ok: false, error };
}
