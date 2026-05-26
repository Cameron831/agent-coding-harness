import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  formatCleanupSuccess,
  parseCleanupCliArgs,
  runCleanupCli,
  type CleanupIssueWorkspaceDependencies,
  type CleanupIssueWorkspaceOptions,
  type CleanupIssueWorkspaceResult
} from "../src/index.js";

const successResult: CleanupIssueWorkspaceResult = {
  ok: true,
  value: {
    issueNumber: 119,
    runPath: ".runs/issue-119/run.json",
    worktree: {
      targetRepositoryPath: "C:/repos/target",
      targetWorktreePath: "C:/repos/worktrees/issue-119",
      removed: true
    },
    branch: {
      targetRepositoryPath: "C:/repos/target",
      branchName: "119-cleanup-command",
      deleted: true
    }
  }
};

test("cleanup CLI parses issue option", () => {
  const result = parseCleanupCliArgs(["--issue", "119"]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    issueNumber: 119
  });
});

test("cleanup success output reports an already-absent branch as a no-op", () => {
  const output = formatCleanupSuccess({
    ...successResult.value,
    branch: {
      ...successResult.value.branch,
      deleted: false
    }
  });

  assert.match(output, /Branch already absent: 119-cleanup-command/);
});

test("cleanup CLI rejects invalid usage and force options", () => {
  const missingIssue = parseCleanupCliArgs([]);
  const invalidIssue = parseCleanupCliArgs(["--issue", "0"]);
  const duplicate = parseCleanupCliArgs(["--issue", "119", "--issue", "120"]);
  const missingValue = parseCleanupCliArgs(["--issue"]);
  const force = parseCleanupCliArgs(["--issue", "119", "--force"]);
  const positional = parseCleanupCliArgs(["--issue", "119", "extra"]);

  assert.equal(missingIssue.ok, false);
  assert.match(!missingIssue.ok ? missingIssue.message : "", /--issue is required/);
  assert.equal(invalidIssue.ok, false);
  assert.match(!invalidIssue.ok ? invalidIssue.message : "", /positive integer/);
  assert.equal(duplicate.ok, false);
  assert.match(!duplicate.ok ? duplicate.message : "", /--issue may only/);
  assert.equal(missingValue.ok, false);
  assert.match(!missingValue.ok ? missingValue.message : "", /requires a value/);
  assert.equal(force.ok, false);
  assert.match(!force.ok ? force.message : "", /Unknown option: --force/);
  assert.equal(positional.ok, false);
  assert.match(
    !positional.ok ? positional.message : "",
    /Unexpected positional argument/
  );
});

test("cleanup CLI runner forwards resolved runtime inputs and dependencies", async () => {
  await withTemporaryCwd(async (directory) => {
    writeCleanupRuntimeFiles(directory);

    let capturedOptions: CleanupIssueWorkspaceOptions | undefined;
    let capturedDependencies: CleanupIssueWorkspaceDependencies | undefined;
    const dependencies: CleanupIssueWorkspaceDependencies = {};

    const exitCode = await runCleanupCli(["--issue", "119"], {
      stdout: () => undefined,
      workflowDependencies: dependencies,
      runCleanupIssueWorkspaceWorkflow: async (options, workflowDependencies) => {
        capturedOptions = options;
        capturedDependencies = workflowDependencies;
        return successResult;
      }
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(capturedOptions, {
      issueNumber: 119,
      runPath: ".runs/issue-119/run.json",
      targetRepositoryPath: "C:/repos/target",
      targetWorktreePath: "C:/repos/worktrees/issue-119",
      branch: "119-cleanup-command"
    });
    assert.equal(capturedDependencies, dependencies);
  });
});

test("cleanup CLI runner fails before workflow when runtime inputs are missing or invalid", async () => {
  await withTemporaryCwd(async (directory) => {
    await assertRuntimeFailure(directory, /Missing \.env/, () => undefined);
    await assertRuntimeFailure(directory, /TARGET_REPO_PATH is required/, () => {
      writeEnv(directory, {});
      writeRunJson(directory, {
        worktreePath: "C:/repos/worktrees/issue-119",
        branch: "119-cleanup-command"
      });
    });
    await assertRuntimeFailure(directory, /Missing run artifact/, () => {
      writeEnv(directory);
    });
    await assertRuntimeFailure(directory, /must be valid JSON/, () => {
      writeEnv(directory);
      writeRawRunJson(directory, "{");
    });
    await assertRuntimeFailure(directory, /must be a JSON object/, () => {
      writeEnv(directory);
      writeRawRunJson(directory, "[]");
    });
    await assertRuntimeFailure(directory, /missing worktreePath/, () => {
      writeEnv(directory);
      writeRunJson(directory, { branch: "119-cleanup-command" });
    });
    await assertRuntimeFailure(directory, /missing branch/, () => {
      writeEnv(directory);
      writeRunJson(directory, {
        worktreePath: "C:/repos/worktrees/issue-119"
      });
    });
  });
});

test("cleanup CLI runner prints concise success output", async () => {
  await withTemporaryCwd(async (directory) => {
    writeCleanupRuntimeFiles(directory);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCleanupCli(["--issue", "119"], {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runCleanupIssueWorkspaceWorkflow: async () => successResult
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.length, 0);
    assert.equal(stdout.join("\n"), formatCleanupSuccess(successResult.value));
    assert.match(stdout.join("\n"), /Worktree removed: C:\/repos\/worktrees\/issue-119/);
    assert.match(stdout.join("\n"), /Branch deleted: 119-cleanup-command/);
    assert.match(stdout.join("\n"), /Run artifact: \.runs\/issue-119\/run\.json/);
  });
});

test("cleanup CLI runner reports branch failure and completed worktree cleanup", async () => {
  await withTemporaryCwd(async (directory) => {
    writeCleanupRuntimeFiles(directory);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCleanupCli(["--issue", "119"], {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runCleanupIssueWorkspaceWorkflow: async () => ({
        ok: false,
        error: {
          stage: "branch_cleanup",
          code: "unknown",
          message: "error: The branch is not fully merged.",
          worktreeCleanup: successResult.value.worktree
        }
      })
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.length, 0);
    assert.match(stderr.join("\n"), /Cleanup workflow failed at branch_cleanup/);
    assert.match(stderr.join("\n"), /not fully merged/);
    assert.match(stderr.join("\n"), /Worktree removed before branch failure/);
  });
});

async function withTemporaryCwd<T>(
  callback: (directory: string) => T | Promise<T>
): Promise<T> {
  const previousDirectory = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "cleanup-cli-"));

  process.chdir(directory);
  try {
    return await callback(directory);
  } finally {
    process.chdir(previousDirectory);
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeCleanupRuntimeFiles(directory: string): void {
  writeEnv(directory);
  writeRunJson(directory, {
    worktreePath: "C:/repos/worktrees/issue-119",
    branch: "119-cleanup-command"
  });
}

function writeEnv(
  directory: string,
  values: Record<string, string> = {
    TARGET_REPO_PATH: "C:/repos/target"
  }
): void {
  writeFileSync(
    join(directory, ".env"),
    [
      "# cleanup defaults",
      "",
      ...Object.entries(values).map(([key, value]) => `${key}=${value}`)
    ].join("\n")
  );
}

function writeRunJson(directory: string, value: Record<string, unknown>): void {
  writeRawRunJson(directory, JSON.stringify(value));
}

function writeRawRunJson(directory: string, contents: string): void {
  const runDirectory = join(directory, ".runs", "issue-119");
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(join(runDirectory, "run.json"), contents);
}

async function assertRuntimeFailure(
  directory: string,
  expectedMessage: RegExp,
  setup: () => void
): Promise<void> {
  rmSync(join(directory, ".env"), { force: true });
  rmSync(join(directory, ".runs"), { recursive: true, force: true });
  setup();

  let invoked = false;
  const stderr: string[] = [];
  const exitCode = await runCleanupCli(["--issue", "119"], {
    stderr: (message) => stderr.push(message),
    runCleanupIssueWorkspaceWorkflow: async () => {
      invoked = true;
      return successResult;
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(invoked, false);
  assert.match(stderr.join("\n"), expectedMessage);
}
