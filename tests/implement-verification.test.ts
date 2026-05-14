import assert from "node:assert/strict";
import test from "node:test";
import {
  runImplementVerification,
  type GitAutomationClient,
  type GitAutomationResult,
  type ImplementVerificationClock,
  type ImplementVerificationCommandInput,
  type ImplementVerificationCommandResult,
  type ImplementVerificationCommandRunner
} from "../src/index.js";
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
  PushBranchInput,
  PushBranchResult,
  StageFilesInput,
  StageFilesResult,
  WorktreeDetails
} from "../src/index.js";

class FakeGitClient implements GitAutomationClient {
  readonly getHeadInputs: GetHeadInput[] = [];
  readonly getChangedFilesInputs: GetChangedFilesInput[] = [];

  constructor(
    private readonly headResult: GitAutomationResult<GetHeadResult>,
    private readonly changedFilesResult: GitAutomationResult<GetChangedFilesResult>
  ) {}

  async getHead(input: GetHeadInput): Promise<GitAutomationResult<GetHeadResult>> {
    this.getHeadInputs.push(input);
    return this.headResult;
  }

  async getChangedFiles(
    input: GetChangedFilesInput
  ): Promise<GitAutomationResult<GetChangedFilesResult>> {
    this.getChangedFilesInputs.push(input);
    return this.changedFilesResult;
  }

  async createWorktree(): Promise<GitAutomationResult<WorktreeDetails>> {
    throw new Error("not used");
  }

  async stageFiles(): Promise<GitAutomationResult<StageFilesResult>> {
    throw new Error("not used");
  }

  async getDiff(): Promise<GitAutomationResult<GetDiffResult>> {
    throw new Error("not used");
  }

  async commit(): Promise<GitAutomationResult<CommitResult>> {
    throw new Error("not used");
  }

  async pushBranch(): Promise<GitAutomationResult<PushBranchResult>> {
    throw new Error("not used");
  }

  async cleanupWorktree(): Promise<GitAutomationResult<CleanupWorktreeResult>> {
    throw new Error("not used");
  }
}

class FakeCommandRunner implements ImplementVerificationCommandRunner {
  readonly inputs: ImplementVerificationCommandInput[] = [];

  constructor(private readonly result: ImplementVerificationCommandResult) {}

  async run(
    input: ImplementVerificationCommandInput
  ): Promise<ImplementVerificationCommandResult> {
    this.inputs.push(input);
    return this.result;
  }
}

class FakeClock implements ImplementVerificationClock {
  private index = 0;

  constructor(private readonly dates: Date[]) {}

  now(): Date {
    return this.dates[this.index++] ?? this.dates[this.dates.length - 1];
  }
}

const targetWorktreePath = "C:/repos/worktrees/issue-60";

test("implement verification passes when HEAD is unchanged, files changed, and tests pass", async () => {
  const gitClient = new FakeGitClient(
    {
      ok: true,
      value: {
        targetWorktreePath,
        head: "abc123"
      }
    },
    {
      ok: true,
      value: {
        targetWorktreePath,
        files: ["src/workflow/implement/verification.ts"]
      }
    }
  );
  const commandRunner = new FakeCommandRunner({
    command: "npm ci && npm run test",
    exitCode: 0,
    output: "line 1\nline 2\n"
  });

  const result = await runImplementVerification(
    {
      issueNumber: 60,
      targetWorktreePath,
      beforeHead: "abc123"
    },
    {
      gitClient,
      commandRunner,
      clock: new FakeClock([
        new Date("2026-05-08T18:00:00.000Z"),
        new Date("2026-05-08T18:00:05.000Z")
      ])
    }
  );

  assert.equal(result.status, "passed");
  assert.equal(result.afterHead, "abc123");
  assert.deepEqual(result.changedFiles, [
    "src/workflow/implement/verification.ts"
  ]);
  assert.deepEqual(
    result.checks.map((check) => [check.name, check.status]),
    [
      ["HEAD unchanged", "passed"],
      ["Worktree has changes", "passed"],
      ["Test suite", "passed"]
    ]
  );
  assert.deepEqual(gitClient.getHeadInputs, [{ targetWorktreePath }]);
  assert.deepEqual(gitClient.getChangedFilesInputs, [{ targetWorktreePath }]);
  assert.deepEqual(commandRunner.inputs, [
    {
      command: "npm ci && npm run test",
      cwd: targetWorktreePath
    }
  ]);
  assert.match(result.report, /^Verification Report\nIssue: #60\nStatus: passed/m);
  assert.match(result.report, /Started At: 2026-05-08T18:00:00.000Z/);
  assert.match(result.report, /Finished At: 2026-05-08T18:00:05.000Z/);
  assert.match(result.report, /\[passed\] HEAD unchanged/);
  assert.match(result.report, /Before HEAD: abc123\nAfter HEAD: abc123/);
  assert.match(result.report, /\[passed\] Worktree has changes/);
  assert.match(result.report, /\[passed\] Test suite/);
  assert.match(result.report, /- src\/workflow\/implement\/verification\.ts/);
  assert.match(result.report, /Command: npm ci && npm run test\nExit Code: 0/);
  assert.ok(result.report.endsWith("line 1\nline 2\n"));
});

test("implement verification fails when checks fail and preserves raw test output", async () => {
  const gitClient = new FakeGitClient(
    {
      ok: true,
      value: {
        targetWorktreePath,
        head: "def456"
      }
    },
    {
      ok: true,
      value: {
        targetWorktreePath,
        files: []
      }
    }
  );
  const rawOutput = "failed test output\n\nstderr line\n";
  const commandRunner = new FakeCommandRunner({
    command: "npm run test",
    exitCode: 1,
    output: rawOutput
  });

  const result = await runImplementVerification(
    {
      issueNumber: 60,
      targetWorktreePath,
      beforeHead: "abc123"
    },
    {
      gitClient,
      commandRunner,
      clock: new FakeClock([
        new Date("2026-05-08T19:00:00.000Z"),
        new Date("2026-05-08T19:00:10.000Z")
      ])
    }
  );

  assert.equal(result.status, "failed");
  assert.equal(result.afterHead, "def456");
  assert.deepEqual(result.changedFiles, []);
  assert.deepEqual(
    result.checks.map((check) => [check.name, check.status]),
    [
      ["HEAD unchanged", "failed"],
      ["Worktree has changes", "failed"],
      ["Test suite", "failed"]
    ]
  );
  assert.equal(result.testCommand.output, rawOutput);
  assert.match(result.report, /\[failed\] HEAD unchanged/);
  assert.match(result.report, /Before HEAD: abc123\nAfter HEAD: def456/);
  assert.match(result.report, /\[failed\] Worktree has changes/);
  assert.match(result.report, /\[failed\] Test suite/);
  assert.ok(result.report.includes("Changed Files:\n- None"));
  assert.ok(result.report.endsWith(rawOutput));
});

test("implement verification returns a structured failure when git retrieval fails", async () => {
  const gitClient = new FakeGitClient(
    {
      ok: false,
      error: {
        code: "unknown",
        message: "fatal: not a git repository"
      }
    },
    {
      ok: true,
      value: {
        targetWorktreePath,
        files: ["tests/implement-verification.test.ts"]
      }
    }
  );
  const commandRunner = new FakeCommandRunner({
    command: "npm run test",
    exitCode: 0,
    output: "ok\n"
  });

  const result = await runImplementVerification(
    {
      issueNumber: 60,
      targetWorktreePath,
      beforeHead: "abc123"
    },
    {
      gitClient,
      commandRunner,
      clock: new FakeClock([
        new Date("2026-05-08T20:00:00.000Z"),
        new Date("2026-05-08T20:00:03.000Z")
      ])
    }
  );

  assert.equal(result.status, "failed");
  assert.equal(result.afterHead, undefined);
  assert.equal(result.error, "fatal: not a git repository");
  assert.deepEqual(
    result.checks.map((check) => [check.name, check.status]),
    [
      ["HEAD unchanged", "failed"],
      ["Worktree has changes", "passed"],
      ["Test suite", "passed"]
    ]
  );
  assert.match(result.report, /Error: fatal: not a git repository/);
});
