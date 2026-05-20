import assert from "node:assert/strict";
import test from "node:test";

import { LocalGitAutomationClient } from "../src/git/git-client.js";
import type { GitCommandResult, GitCommandRunner } from "../src/git/git-runner.js";
import type { CleanupWorktreeInput } from "../src/git/types.js";

const validCleanupInput: CleanupWorktreeInput = {
  targetRepositoryPath: "C:/repos/target",
  targetWorktreePath: "C:/repos/worktrees/issue-23"
};

class FakeGitCommandRunner implements GitCommandRunner {
  readonly calls: readonly string[][] = [];
  private readonly results: GitCommandResult[];

  constructor(result: GitCommandResult | GitCommandResult[]) {
    this.results = Array.isArray(result) ? [...result] : [result];
  }

  async run(args: readonly string[]): Promise<GitCommandResult> {
    (this.calls as string[][]).push([...args]);
    return (
      this.results.shift() ?? {
        exitCode: 0,
        stdout: "",
        stderr: ""
      }
    );
  }
}

test("LocalGitAutomationClient removes a clean associated worktree", async () => {
  const runner = new FakeGitCommandRunner([
    {
      exitCode: 0,
      stdout:
        "worktree C:/repos/target\nHEAD abc123\nbranch refs/heads/main\n\nworktree C:/repos/worktrees/issue-23\nHEAD def456\nbranch refs/heads/issue-23\n",
      stderr: ""
    },
    { exitCode: 0, stdout: "", stderr: "" },
    { exitCode: 0, stdout: "", stderr: "" },
    { exitCode: 0, stdout: "", stderr: "" }
  ]);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.cleanupWorktree(validCleanupInput);

  assert.deepEqual(runner.calls, [
    [
      "-C",
      "C:/repos/target",
      "worktree",
      "list",
      "--porcelain"
    ],
    ["-C", "C:/repos/worktrees/issue-23", "status", "--porcelain"],
    ["-C", "C:/repos/worktrees/issue-23", "clean", "-fdX"],
    [
      "-C",
      "C:/repos/target",
      "worktree",
      "remove",
      "C:/repos/worktrees/issue-23"
    ]
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      ...validCleanupInput,
      removed: true
    }
  });
});

test("LocalGitAutomationClient treats already absent worktree cleanup as idempotent", async () => {
  const runner = new FakeGitCommandRunner({
    exitCode: 0,
    stdout:
      "worktree C:/repos/target\nHEAD abc123\nbranch refs/heads/main\n\nworktree C:/repos/worktrees/other\nHEAD def456\nbranch refs/heads/other\n",
    stderr: ""
  });
  const client = new LocalGitAutomationClient(runner);

  const result = await client.cleanupWorktree(validCleanupInput);

  assert.deepEqual(runner.calls, [
    [
      "-C",
      "C:/repos/target",
      "worktree",
      "list",
      "--porcelain"
    ]
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      ...validCleanupInput,
      removed: false
    }
  });
});

test("LocalGitAutomationClient includes force only for explicit force cleanup", async () => {
  const runner = new FakeGitCommandRunner([
    {
      exitCode: 0,
      stdout: "worktree C:/repos/worktrees/issue-23\nHEAD def456\n",
      stderr: ""
    },
    { exitCode: 0, stdout: " M src/index.ts\n", stderr: "" },
    { exitCode: 0, stdout: "", stderr: "" },
    { exitCode: 0, stdout: "", stderr: "" }
  ]);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.cleanupWorktree({
    ...validCleanupInput,
    force: true
  });

  assert.deepEqual(runner.calls, [
    [
      "-C",
      "C:/repos/target",
      "worktree",
      "list",
      "--porcelain"
    ],
    ["-C", "C:/repos/worktrees/issue-23", "status", "--porcelain"],
    ["-C", "C:/repos/worktrees/issue-23", "clean", "-fdX"],
    [
      "-C",
      "C:/repos/target",
      "worktree",
      "remove",
      "--force",
      "C:/repos/worktrees/issue-23"
    ]
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      ...validCleanupInput,
      removed: true
    }
  });
});

test("LocalGitAutomationClient refuses dirty worktree cleanup without force before removal", async () => {
  const runner = new FakeGitCommandRunner([
    {
      exitCode: 0,
      stdout: "worktree C:/repos/worktrees/issue-23\nHEAD def456\n",
      stderr: ""
    },
    { exitCode: 0, stdout: " M src/index.ts\n", stderr: "" }
  ]);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.cleanupWorktree(validCleanupInput);

  assert.deepEqual(runner.calls, [
    [
      "-C",
      "C:/repos/target",
      "worktree",
      "list",
      "--porcelain"
    ],
    ["-C", "C:/repos/worktrees/issue-23", "status", "--porcelain"]
  ]);
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "validation_failed",
      message: "Target worktree has uncommitted changes. Use force to remove it."
    }
  });
});

test("LocalGitAutomationClient validates cleanupWorktree input before running git", async () => {
  const cases: Array<[string, Partial<CleanupWorktreeInput>]> = [
    [
      "missing targetRepositoryPath",
      { targetWorktreePath: validCleanupInput.targetWorktreePath }
    ],
    [
      "blank targetRepositoryPath",
      { ...validCleanupInput, targetRepositoryPath: " " }
    ],
    [
      "broad targetRepositoryPath",
      { ...validCleanupInput, targetRepositoryPath: "C:/" }
    ],
    [
      "missing targetWorktreePath",
      { targetRepositoryPath: validCleanupInput.targetRepositoryPath }
    ],
    [
      "blank targetWorktreePath",
      { ...validCleanupInput, targetWorktreePath: "\t" }
    ],
    [
      "broad targetWorktreePath",
      { ...validCleanupInput, targetWorktreePath: "." }
    ]
  ];

  for (const [caseName, input] of cases) {
    const runner = new FakeGitCommandRunner({
      exitCode: 0,
      stdout: "",
      stderr: ""
    });
    const client = new LocalGitAutomationClient(runner);

    const result = await client.cleanupWorktree(input as CleanupWorktreeInput);

    assert.equal(result.ok, false, caseName);
    assert.equal(result.ok || result.error.code, "validation_failed", caseName);
    assert.deepEqual(runner.calls, [], caseName);
  }
});

test("LocalGitAutomationClient returns cleanup list git failures with the command result as cause", async () => {
  const gitResult = {
    exitCode: 128,
    stdout: "",
    stderr: "fatal: not a git repository\n"
  };
  const runner = new FakeGitCommandRunner(gitResult);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.cleanupWorktree(validCleanupInput);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unknown");
    assert.equal(result.error.message, "fatal: not a git repository");
    assert.equal(result.error.cause, gitResult);
  }
});

test("LocalGitAutomationClient returns cleanup status git failures with the command result as cause", async () => {
  const gitResult = {
    exitCode: 128,
    stdout: "",
    stderr: "fatal: cannot change to worktree\n"
  };
  const runner = new FakeGitCommandRunner([
    {
      exitCode: 0,
      stdout: "worktree C:/repos/worktrees/issue-23\nHEAD def456\n",
      stderr: ""
    },
    gitResult
  ]);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.cleanupWorktree(validCleanupInput);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unknown");
    assert.equal(result.error.message, "fatal: cannot change to worktree");
    assert.equal(result.error.cause, gitResult);
  }
});

test("LocalGitAutomationClient returns cleanup clean git failures before removal", async () => {
  const gitResult = {
    exitCode: 1,
    stdout: "",
    stderr: "fatal: clean failed\n"
  };
  const runner = new FakeGitCommandRunner([
    {
      exitCode: 0,
      stdout: "worktree C:/repos/worktrees/issue-23\nHEAD def456\n",
      stderr: ""
    },
    { exitCode: 0, stdout: "", stderr: "" },
    gitResult
  ]);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.cleanupWorktree(validCleanupInput);

  assert.deepEqual(runner.calls, [
    [
      "-C",
      "C:/repos/target",
      "worktree",
      "list",
      "--porcelain"
    ],
    ["-C", "C:/repos/worktrees/issue-23", "status", "--porcelain"],
    ["-C", "C:/repos/worktrees/issue-23", "clean", "-fdX"]
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unknown");
    assert.equal(result.error.message, "fatal: clean failed");
    assert.equal(result.error.cause, gitResult);
  }
});

test("LocalGitAutomationClient returns cleanup remove git failures with the command result as cause", async () => {
  const gitResult = {
    exitCode: 255,
    stdout: "",
    stderr: "fatal: worktree contains modified or untracked files\n"
  };
  const runner = new FakeGitCommandRunner([
    {
      exitCode: 0,
      stdout: "worktree C:/repos/worktrees/issue-23\nHEAD def456\n",
      stderr: ""
    },
    { exitCode: 0, stdout: "", stderr: "" },
    { exitCode: 0, stdout: "", stderr: "" },
    gitResult
  ]);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.cleanupWorktree(validCleanupInput);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unknown");
    assert.equal(
      result.error.message,
      "fatal: worktree contains modified or untracked files"
    );
    assert.equal(result.error.cause, gitResult);
  }
});
