import path from "node:path";

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
  GetChangedFilesInput,
  GetChangedFilesResult,
  GetDiffInput,
  GetDiffResult,
  GetHeadInput,
  GetHeadResult,
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

  async getDiff(input: GetDiffInput): Promise<GitAutomationResult<GetDiffResult>> {
    const validationError = validateTargetWorktreePath(input);
    if (validationError) {
      return failure(validationError);
    }

    const result = await this.runCommand([
      "-C",
      input.targetWorktreePath,
      "diff",
      "HEAD",
      "--"
    ]);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        targetWorktreePath: input.targetWorktreePath,
        diff: result.value.stdout
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

  async getChangedFiles(
    input: GetChangedFilesInput
  ): Promise<GitAutomationResult<GetChangedFilesResult>> {
    const validationError = validateTargetWorktreePath(input);
    if (validationError) {
      return failure(validationError);
    }

    const result = await this.runCommand([
      "-C",
      input.targetWorktreePath,
      "status",
      "--porcelain"
    ]);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        targetWorktreePath: input.targetWorktreePath,
        files: parsePorcelainChangedFiles(result.value.stdout)
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
    input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>> {
    const validationError = validateCleanupWorktreeInput(input);
    if (validationError) {
      return failure(validationError);
    }

    const listResult = await this.runCommand([
      "-C",
      input.targetRepositoryPath,
      "worktree",
      "list",
      "--porcelain"
    ]);
    if (!listResult.ok) {
      return listResult;
    }

    if (
      !isKnownWorktreePath(
        listResult.value.stdout,
        input.targetWorktreePath
      )
    ) {
      return failure({
        code: "validation_failed",
        message:
          "Target worktree path is not associated with the target repository."
      });
    }

    const statusResult = await this.runCommand([
      "-C",
      input.targetWorktreePath,
      "status",
      "--porcelain"
    ]);
    if (!statusResult.ok) {
      return statusResult;
    }

    if (statusResult.value.stdout.trim() !== "" && input.force !== true) {
      return failure({
        code: "validation_failed",
        message: "Target worktree has uncommitted changes. Use force to remove it."
      });
    }

    const removeArgs = [
      "-C",
      input.targetRepositoryPath,
      "worktree",
      "remove"
    ];
    if (input.force === true) {
      removeArgs.push("--force");
    }
    removeArgs.push(input.targetWorktreePath);

    const removeResult = await this.runCommand(removeArgs);
    if (!removeResult.ok) {
      return removeResult;
    }

    return {
      ok: true,
      value: {
        targetRepositoryPath: input.targetRepositoryPath,
        targetWorktreePath: input.targetWorktreePath,
        removed: true
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

function validateCleanupWorktreeInput(
  input: CleanupWorktreeInput
): GitAutomationError | undefined {
  const targetRepositoryPathError = validateCleanupPath(
    input.targetRepositoryPath,
    "Target repository path"
  );
  if (targetRepositoryPathError) {
    return targetRepositoryPathError;
  }

  const targetWorktreePathError = validateCleanupPath(
    input.targetWorktreePath,
    "Target worktree path"
  );
  if (targetWorktreePathError) {
    return targetWorktreePathError;
  }

  return undefined;
}

function validateCleanupPath(
  pathValue: string,
  label: string
): GitAutomationError | undefined {
  if (typeof pathValue !== "string" || pathValue.trim() === "") {
    return {
      code: "validation_failed",
      message: `${label} is required.`
    };
  }

  if (isBroadPath(pathValue)) {
    return {
      code: "validation_failed",
      message: `${label} is too broad for cleanup.`
    };
  }

  return undefined;
}

function isBroadPath(pathValue: string): boolean {
  const trimmedPath = pathValue.trim();
  if (trimmedPath === "." || trimmedPath === "..") {
    return true;
  }

  const normalizedPath = path.normalize(trimmedPath);
  const parsedPath = path.parse(normalizedPath);
  return normalizedPath === parsedPath.root;
}

function isKnownWorktreePath(
  worktreeListPorcelain: string,
  targetWorktreePath: string
): boolean {
  const expectedPath = normalizePathForComparison(targetWorktreePath);
  return worktreeListPorcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .some(
      (line) =>
        normalizePathForComparison(line.slice("worktree ".length)) ===
        expectedPath
    );
}

function normalizePathForComparison(pathValue: string): string {
  return path.normalize(pathValue.trim()).replaceAll("\\", "/").toLowerCase();
}

function parsePorcelainChangedFiles(statusOutput: string): string[] {
  return statusOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .map((line) => parsePorcelainChangedFile(line))
    .filter((file): file is string => file !== undefined);
}

function parsePorcelainChangedFile(line: string): string | undefined {
  const status = line.slice(0, 2);
  const pathText = line.slice(3).trim();
  if (pathText === "") {
    return undefined;
  }

  if (status.includes("R") || status.includes("C")) {
    const renameDestination = pathText.split(" -> ").at(-1)?.trim();
    return renameDestination === "" ? undefined : renameDestination;
  }

  return pathText;
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

function failure<T>(error: GitAutomationError): GitAutomationResult<T> {
  return { ok: false, error };
}
