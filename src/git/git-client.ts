import type { GitAutomationClient } from "./client.js";
import {
  LocalGitCommandRunner,
  type GitCommandResult,
  type GitCommandRunner
} from "./git-runner.js";
import type {
  CleanupWorktreeInput,
  CleanupWorktreeResult,
  CommitInput,
  CommitResult,
  CreateWorktreeInput,
  GitAutomationError,
  GitAutomationResult,
  PushBranchInput,
  PushBranchResult,
  StageFilesInput,
  StageFilesResult,
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

  async stageFiles(
    input: StageFilesInput
  ): Promise<GitAutomationResult<StageFilesResult>> {
    const validationError = validateStageFilesInput(input);
    if (validationError) {
      return failure(validationError);
    }

    const result = await this.runCommand([
      "-C",
      input.targetWorktreePath,
      "add",
      "--",
      ...input.files
    ]);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        targetWorktreePath: input.targetWorktreePath,
        files: input.files
      }
    };
  }

  async commit(input: CommitInput): Promise<GitAutomationResult<CommitResult>> {
    const validationError = validateCommitInput(input);
    if (validationError) {
      return failure(validationError);
    }

    const commitResult = await this.runCommand([
      "-C",
      input.targetWorktreePath,
      "commit",
      "-m",
      input.message
    ]);
    if (!commitResult.ok) {
      return commitResult;
    }

    const revParseResult = await this.runCommand([
      "-C",
      input.targetWorktreePath,
      "rev-parse",
      "HEAD"
    ]);
    if (!revParseResult.ok) {
      return revParseResult;
    }

    return {
      ok: true,
      value: {
        targetWorktreePath: input.targetWorktreePath,
        commitSha: revParseResult.value.stdout.trim()
      }
    };
  }

  async pushBranch(
    input: PushBranchInput
  ): Promise<GitAutomationResult<PushBranchResult>> {
    const validationError = validatePushBranchInput(input);
    if (validationError) {
      return failure(validationError);
    }

    const remoteName = input.remoteName ?? "origin";
    const args = ["-C", input.targetWorktreePath, "push"];
    if (input.setUpstream === true) {
      args.push("-u");
    }
    args.push(remoteName, input.branchName);

    const result = await this.runCommand(args);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        targetWorktreePath: input.targetWorktreePath,
        branchName: input.branchName,
        remoteName
      }
    };
  }

  async cleanupWorktree(
    _input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>> {
    return unsupported();
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

function validateStageFilesInput(
  input: StageFilesInput
): GitAutomationError | undefined {
  const targetWorktreePathError = validateTargetWorktreePath(input);
  if (targetWorktreePathError) {
    return targetWorktreePathError;
  }

  if (
    !Array.isArray(input.files) ||
    input.files.length === 0 ||
    input.files.some((file) => typeof file !== "string" || file.trim() === "")
  ) {
    return {
      code: "validation_failed",
      message: "At least one file path is required."
    };
  }

  return undefined;
}

function validateCommitInput(input: CommitInput): GitAutomationError | undefined {
  const targetWorktreePathError = validateTargetWorktreePath(input);
  if (targetWorktreePathError) {
    return targetWorktreePathError;
  }

  if (typeof input.message !== "string" || input.message.trim() === "") {
    return {
      code: "validation_failed",
      message: "Commit message is required."
    };
  }

  return undefined;
}

function validatePushBranchInput(
  input: PushBranchInput
): GitAutomationError | undefined {
  const targetWorktreePathError = validateTargetWorktreePath(input);
  if (targetWorktreePathError) {
    return targetWorktreePathError;
  }

  if (typeof input.branchName !== "string" || input.branchName.trim() === "") {
    return {
      code: "validation_failed",
      message: "Branch name is required."
    };
  }

  if (
    input.remoteName !== undefined &&
    (typeof input.remoteName !== "string" || input.remoteName.trim() === "")
  ) {
    return {
      code: "validation_failed",
      message: "Remote name must be non-empty when supplied."
    };
  }

  return undefined;
}

function validateTargetWorktreePath(
  input: TargetWorktreeInput
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

interface TargetWorktreeInput {
  targetWorktreePath: string;
}

function unsupported<T>(): GitAutomationResult<T> {
  return failure({
    code: "unavailable",
    message: "This git operation is not supported by LocalGitAutomationClient."
  });
}

function failure<T>(error: GitAutomationError): GitAutomationResult<T> {
  return { ok: false, error };
}
