import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalGitAutomationClient,
  type CommitInput,
  type CreateWorktreeInput,
  type GitCommandResult,
  type GitCommandRunner,
  type PushBranchInput,
  type StageFilesInput
} from "../src/index.js";

const validInput: CreateWorktreeInput = {
  targetRepositoryPath: "C:/repos/target",
  targetWorktreePath: "C:/repos/worktrees/issue-21",
  branchName: "issue-21-create-worktree"
};
const validWorktreePath = "C:/repos/worktrees/issue-22";

class FakeGitCommandRunner implements GitCommandRunner {
  readonly calls: readonly string[][] = [];
  private readonly results: GitCommandResult[];

  constructor(
    result: GitCommandResult | GitCommandResult[] = {
      exitCode: 0,
      stdout: "",
      stderr: ""
    }
  ) {
    this.results = Array.isArray(result) ? [...result] : [result];
  }

  async run(args: readonly string[]): Promise<GitCommandResult> {
    (this.calls as string[][]).push([...args]);
    return this.results.shift() ?? this.results[this.results.length - 1] ?? {
      exitCode: 0,
      stdout: "",
      stderr: ""
    };
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

test("LocalGitAutomationClient stages only caller-provided files in the target worktree", async () => {
  const runner = new FakeGitCommandRunner();
  const client = new LocalGitAutomationClient(runner);

  const result = await client.stageFiles({
    targetWorktreePath: validWorktreePath,
    files: ["src/git/git-client.ts", "tests/git-local-client.test.ts"]
  });

  assert.deepEqual(runner.calls, [
    [
      "-C",
      validWorktreePath,
      "add",
      "--",
      "src/git/git-client.ts",
      "tests/git-local-client.test.ts"
    ]
  ]);
  assert.equal(runner.calls[0]?.includes("."), false);
  assert.equal(runner.calls[0]?.includes(process.cwd()), false);
  assert.deepEqual(result, {
    ok: true,
    value: {
      targetWorktreePath: validWorktreePath,
      files: ["src/git/git-client.ts", "tests/git-local-client.test.ts"]
    }
  });
});

test("LocalGitAutomationClient commits in the target worktree with the supplied message", async () => {
  const runner = new FakeGitCommandRunner([
    {
      exitCode: 0,
      stdout: "[issue-22 abc123] Implement local git write operations\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: "abc123\n",
      stderr: ""
    }
  ]);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.commit({
    targetWorktreePath: validWorktreePath,
    message: "Implement local git write operations"
  });

  assert.deepEqual(runner.calls, [
    [
      "-C",
      validWorktreePath,
      "commit",
      "-m",
      "Implement local git write operations"
    ],
    ["-C", validWorktreePath, "rev-parse", "HEAD"]
  ]);
  assert.equal(runner.calls[0]?.includes(process.cwd()), false);
  assert.deepEqual(result, {
    ok: true,
    value: {
      targetWorktreePath: validWorktreePath,
      commitSha: "abc123"
    }
  });
});

test("LocalGitAutomationClient pushes branches from the target worktree", async () => {
  const runner = new FakeGitCommandRunner();
  const client = new LocalGitAutomationClient(runner);

  const defaultRemoteResult = await client.pushBranch({
    targetWorktreePath: validWorktreePath,
    branchName: "issue-22-local-git-write-ops"
  });
  const suppliedRemoteResult = await client.pushBranch({
    targetWorktreePath: validWorktreePath,
    branchName: "issue-22-local-git-write-ops",
    remoteName: "fork"
  });
  const upstreamResult = await client.pushBranch({
    targetWorktreePath: validWorktreePath,
    branchName: "issue-22-local-git-write-ops",
    remoteName: "fork",
    setUpstream: true
  });

  assert.deepEqual(runner.calls, [
    [
      "-C",
      validWorktreePath,
      "push",
      "origin",
      "issue-22-local-git-write-ops"
    ],
    ["-C", validWorktreePath, "push", "fork", "issue-22-local-git-write-ops"],
    [
      "-C",
      validWorktreePath,
      "push",
      "-u",
      "fork",
      "issue-22-local-git-write-ops"
    ]
  ]);
  assert.equal(runner.calls.every((call) => !call.includes(process.cwd())), true);
  assert.deepEqual(defaultRemoteResult, {
    ok: true,
    value: {
      targetWorktreePath: validWorktreePath,
      branchName: "issue-22-local-git-write-ops",
      remoteName: "origin"
    }
  });
  assert.deepEqual(suppliedRemoteResult, {
    ok: true,
    value: {
      targetWorktreePath: validWorktreePath,
      branchName: "issue-22-local-git-write-ops",
      remoteName: "fork"
    }
  });
  assert.deepEqual(upstreamResult, suppliedRemoteResult);
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

test("LocalGitAutomationClient validates stageFiles input before running git", async () => {
  const cases: Array<[string, Partial<StageFilesInput>]> = [
    ["missing targetWorktreePath", { files: ["src/index.ts"] }],
    [
      "blank targetWorktreePath",
      { targetWorktreePath: " ", files: ["src/index.ts"] }
    ],
    ["missing files", { targetWorktreePath: validWorktreePath }],
    ["empty files", { targetWorktreePath: validWorktreePath, files: [] }],
    [
      "blank file",
      { targetWorktreePath: validWorktreePath, files: ["src/index.ts", "\t"] }
    ]
  ];

  for (const [caseName, input] of cases) {
    const runner = new FakeGitCommandRunner();
    const client = new LocalGitAutomationClient(runner);

    const result = await client.stageFiles(input as StageFilesInput);

    assert.equal(result.ok, false, caseName);
    assert.equal(result.ok || result.error.code, "validation_failed", caseName);
    assert.deepEqual(runner.calls, [], caseName);
  }
});

test("LocalGitAutomationClient validates commit input before running git", async () => {
  const cases: Array<[string, Partial<CommitInput>]> = [
    ["missing targetWorktreePath", { message: "Update files" }],
    [
      "blank targetWorktreePath",
      { targetWorktreePath: "", message: "Update files" }
    ],
    ["missing message", { targetWorktreePath: validWorktreePath }],
    ["blank message", { targetWorktreePath: validWorktreePath, message: "\n" }]
  ];

  for (const [caseName, input] of cases) {
    const runner = new FakeGitCommandRunner();
    const client = new LocalGitAutomationClient(runner);

    const result = await client.commit(input as CommitInput);

    assert.equal(result.ok, false, caseName);
    assert.equal(result.ok || result.error.code, "validation_failed", caseName);
    assert.deepEqual(runner.calls, [], caseName);
  }
});

test("LocalGitAutomationClient validates pushBranch input before running git", async () => {
  const cases: Array<[string, Partial<PushBranchInput>]> = [
    ["missing targetWorktreePath", { branchName: "issue-22" }],
    [
      "blank targetWorktreePath",
      { targetWorktreePath: "\t", branchName: "issue-22" }
    ],
    ["missing branchName", { targetWorktreePath: validWorktreePath }],
    ["blank branchName", { targetWorktreePath: validWorktreePath, branchName: " " }],
    [
      "blank remoteName",
      {
        targetWorktreePath: validWorktreePath,
        branchName: "issue-22",
        remoteName: "\n"
      }
    ]
  ];

  for (const [caseName, input] of cases) {
    const runner = new FakeGitCommandRunner();
    const client = new LocalGitAutomationClient(runner);

    const result = await client.pushBranch(input as PushBranchInput);

    assert.equal(result.ok, false, caseName);
    assert.equal(result.ok || result.error.code, "validation_failed", caseName);
    assert.deepEqual(runner.calls, [], caseName);
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

test("LocalGitAutomationClient returns stageFiles non-zero git failures with the command result as cause", async () => {
  const gitResult = {
    exitCode: 128,
    stdout: "",
    stderr: "fatal: pathspec did not match any files\n"
  };
  const runner = new FakeGitCommandRunner(gitResult);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.stageFiles({
    targetWorktreePath: validWorktreePath,
    files: ["missing.ts"]
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unknown");
    assert.equal(result.error.message, "fatal: pathspec did not match any files");
    assert.equal(result.error.cause, gitResult);
  }
});

test("LocalGitAutomationClient returns commit non-zero git failures with the command result as cause", async () => {
  const gitResult = {
    exitCode: 1,
    stdout: "",
    stderr: "nothing to commit, working tree clean\n"
  };
  const runner = new FakeGitCommandRunner(gitResult);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.commit({
    targetWorktreePath: validWorktreePath,
    message: "Update files"
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unknown");
    assert.equal(result.error.message, "nothing to commit, working tree clean");
    assert.equal(result.error.cause, gitResult);
  }
});

test("LocalGitAutomationClient returns pushBranch non-zero git failures with the command result as cause", async () => {
  const gitResult = {
    exitCode: 128,
    stdout: "",
    stderr: "fatal: could not read from remote repository\n"
  };
  const runner = new FakeGitCommandRunner(gitResult);
  const client = new LocalGitAutomationClient(runner);

  const result = await client.pushBranch({
    targetWorktreePath: validWorktreePath,
    branchName: "issue-22"
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unknown");
    assert.equal(result.error.message, "fatal: could not read from remote repository");
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
