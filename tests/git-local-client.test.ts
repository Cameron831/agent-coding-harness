import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalGitAutomationClient,
  type CreateWorktreeInput,
  type GitCommandResult,
  type GitCommandRunner
} from "../src/index.js";

const validInput: CreateWorktreeInput = {
  targetRepositoryPath: "C:/repos/target",
  targetWorktreePath: "C:/repos/worktrees/issue-21",
  branchName: "issue-21-create-worktree"
};

class FakeGitCommandRunner implements GitCommandRunner {
  readonly calls: readonly string[][] = [];

  constructor(
    private readonly result: GitCommandResult = {
      exitCode: 0,
      stdout: "",
      stderr: ""
    }
  ) {}

  async run(args: readonly string[]): Promise<GitCommandResult> {
    (this.calls as string[][]).push([...args]);
    return this.result;
  }
}

test("LocalGitAutomationClient creates a worktree using the target repository path", async () => {
  const runner = new FakeGitCommandRunner();
  const client = new LocalGitAutomationClient(runner);

  const result = await client.createWorktree(validInput);

  assert.deepEqual(runner.calls, [
    [
      "-C",
      "C:/repos/target",
      "worktree",
      "add",
      "-b",
      "issue-21-create-worktree",
      "C:/repos/worktrees/issue-21"
    ]
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: validInput
  });
});

test("LocalGitAutomationClient appends baseRef when supplied", async () => {
  const runner = new FakeGitCommandRunner();
  const client = new LocalGitAutomationClient(runner);

  const result = await client.createWorktree({
    ...validInput,
    baseRef: "origin/main"
  });

  assert.deepEqual(runner.calls[0], [
    "-C",
    "C:/repos/target",
    "worktree",
    "add",
    "-b",
    "issue-21-create-worktree",
    "C:/repos/worktrees/issue-21",
    "origin/main"
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      ...validInput,
      baseRef: "origin/main"
    }
  });
});

test("LocalGitAutomationClient validates createWorktree input before running git", async () => {
  const cases: Array<[string, Partial<CreateWorktreeInput>]> = [
    [
      "missing targetRepositoryPath",
      {
        targetWorktreePath: validInput.targetWorktreePath,
        branchName: validInput.branchName
      }
    ],
    [
      "targetRepositoryPath",
      {
        ...validInput,
        targetRepositoryPath: " "
      }
    ],
    [
      "missing targetWorktreePath",
      {
        targetRepositoryPath: validInput.targetRepositoryPath,
        branchName: validInput.branchName
      }
    ],
    [
      "targetWorktreePath",
      {
        ...validInput,
        targetWorktreePath: ""
      }
    ],
    [
      "missing branchName",
      {
        targetRepositoryPath: validInput.targetRepositoryPath,
        targetWorktreePath: validInput.targetWorktreePath
      }
    ],
    [
      "branchName",
      {
        ...validInput,
        branchName: "\t"
      }
    ],
    [
      "baseRef",
      {
        ...validInput,
        baseRef: "\n"
      }
    ]
  ];

  for (const [fieldName, input] of cases) {
    const runner = new FakeGitCommandRunner();
    const client = new LocalGitAutomationClient(runner);

    const result = await client.createWorktree(input as CreateWorktreeInput);

    assert.equal(result.ok, false, fieldName);
    assert.equal(result.ok || result.error.code, "validation_failed", fieldName);
    assert.deepEqual(runner.calls, [], fieldName);
  }
});

test("LocalGitAutomationClient returns non-zero git failures with the command result as cause", async () => {
  const gitResult = {
    exitCode: 128,
    stdout: "",
    stderr: "fatal: invalid reference\n"
  };
  const runner = new FakeGitCommandRunner(gitResult);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.createWorktree(validInput);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unknown");
    assert.equal(result.error.message, "fatal: invalid reference");
    assert.equal(result.error.cause, gitResult);
  }
});

test("LocalGitAutomationClient returns runner errors as git availability failures", async () => {
  const cause = new Error("spawn git ENOENT");
  const runner: GitCommandRunner = {
    async run() {
      throw cause;
    }
  };
  const client = new LocalGitAutomationClient(runner);

  const result = await client.createWorktree(validInput);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unavailable");
    assert.equal(result.error.message, "Failed to run git.");
    assert.equal(result.error.cause, cause);
  }
});
