import path from "node:path";

import {
  LocalGitCommandRunner,
  type GitCommandResult,
  type GitCommandRunner
} from "./git-runner.js";
import type {
  CleanupWorktreeInput,
  CleanupWorktreeResult,
  GitAutomationError,
  GitAutomationResult
} from "./types.js";

export class LocalGitAutomationClient {
  constructor(
    private readonly runner: GitCommandRunner = new LocalGitCommandRunner()
  ) {}

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

    const cleanResult = await this.runCommand([
      "-C",
      input.targetWorktreePath,
      "clean",
      "-fdX"
    ]);
    if (!cleanResult.ok) {
      return cleanResult;
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

function failure<T>(error: GitAutomationError): GitAutomationResult<T> {
  return { ok: false, error };
}
