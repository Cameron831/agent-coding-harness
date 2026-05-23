import type { GitAutomationClient } from "./client.js";
import {
  LocalGitCommandRunner,
  type GitCommandResult,
  type GitCommandRunner
} from "./git-runner.js";
import type {
  CreateWorktreeInput,
  GetHeadInput,
  GetHeadResult,
  GitAutomationError,
  GitAutomationResult,
  WorktreeDetails
} from "./types.js";

export class LocalGitAutomationClient implements GitAutomationClient {
  constructor(
    private readonly runner: GitCommandRunner = new LocalGitCommandRunner()
  ) {}

  async createWorktree(
    input: CreateWorktreeInput
  ): Promise<GitAutomationResult<WorktreeDetails>> {
    const validationError = validateCreateWorktreeInput(input);
    if (validationError) {
      return failure(validationError);
    }

    const args = [
      "-C",
      input.targetRepositoryPath,
      "worktree",
      "add",
      "-b",
      input.branchName,
      input.targetWorktreePath
    ];
    if (input.baseRef !== undefined) {
      args.push(input.baseRef);
    }

    const result = await this.runCommand(args);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        targetRepositoryPath: input.targetRepositoryPath,
        targetWorktreePath: input.targetWorktreePath,
        branchName: input.branchName,
        ...(input.baseRef !== undefined ? { baseRef: input.baseRef } : {})
      }
    };
  }

  async getHead(input: GetHeadInput): Promise<GitAutomationResult<GetHeadResult>> {
    const validationError = validateTargetWorktreePath(input);
    if (validationError) {
      return failure(validationError);
    }

    const result = await this.runCommand([
      "-C",
      input.targetWorktreePath,
      "rev-parse",
      "HEAD"
    ]);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        targetWorktreePath: input.targetWorktreePath,
        head: result.value.stdout.trim()
      }
    };
  }

  private async runCommand(
    args: readonly string[]
  ): Promise<GitAutomationResult<GitCommandResult>> {
    let result;
    try {
      result = await this.runner.run(args);
    } catch (cause) {
      return failure({
        code: "unavailable",
        message: "Failed to run git.",
        cause
      });
    }

    if (result.exitCode !== 0) {
      return failure({
        code: "unknown",
        message: result.stderr.trim() || `git exited with code ${result.exitCode}.`,
        cause: result
      });
    }

    return { ok: true, value: result };
  }
}

function validateCreateWorktreeInput(
  input: CreateWorktreeInput
): GitAutomationError | undefined {
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
    typeof input.targetWorktreePath !== "string" ||
    input.targetWorktreePath.trim() === ""
  ) {
    return {
      code: "validation_failed",
      message: "Target worktree path is required."
    };
  }

  if (typeof input.branchName !== "string" || input.branchName.trim() === "") {
    return {
      code: "validation_failed",
      message: "Branch name is required."
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

function validateTargetWorktreePath(
  input: GetHeadInput
): GitAutomationError | undefined {
  if (
    typeof input.targetWorktreePath !== "string" ||
    input.targetWorktreePath.trim() === ""
  ) {
    return {
      code: "validation_failed",
      message: "Target worktree path is required."
    };
  }

  return undefined;
}

function failure<T>(error: GitAutomationError): GitAutomationResult<T> {
  return { ok: false, error };
}
