import assert from "node:assert/strict";
import test from "node:test";
import {
  formatImplementSuccess,
  parseImplementCliArgs,
  runImplementCli,
  type ImplementIssueWorkflowDependencies,
  type ImplementIssueWorkflowOptions,
  type ImplementIssueWorkflowResult
} from "../src/index.js";

const successResult: ImplementIssueWorkflowResult = {
  ok: true,
  value: {
    release: {
      commit_message: "Add implement CLI",
      pull_request: {
        title: "Add implement CLI",
        summary: "Runs the implement workflow from explicit CLI inputs.",
        scope: ["Added implement CLI."],
        verification: ["npm test"]
      }
    },
    verification: {
      issueNumber: 73,
      targetWorktreePath: "C:/repos/worktrees/issue-73",
      status: "passed",
      startedAt: "2026-05-13T18:00:00.000Z",
      finishedAt: "2026-05-13T18:00:03.000Z",
      beforeHead: "abc123before",
      afterHead: "abc123before",
      changedFiles: ["src/workflow/implement/cli-implement.ts"],
      checks: [
        {
          name: "Test suite",
          status: "passed",
          passed: true,
          details: "Exit code: 0"
        }
      ],
      testCommand: {
        command: "npm test",
        exitCode: 0,
        output: "passed"
      },
      report: "Verification Report"
    },
    diff: {
      targetWorktreePath: "C:/repos/worktrees/issue-73",
      diff: "diff --git a/file.ts b/file.ts\n"
    },
    artifacts: {
      runDirectory: ".runs/issue-73",
      diffPath: ".runs/issue-73/diff.patch",
      verificationOutputPath: ".runs/issue-73/verification.txt",
      releasePath: ".runs/issue-73/release.json",
      runPath: ".runs/issue-73/run.json",
      release: {
        commit_message: "Add implement CLI",
        pull_request: {
          title: "Add implement CLI",
          summary: "Runs the implement workflow from explicit CLI inputs.",
          scope: ["Added implement CLI."],
          verification: ["npm test"]
        }
      },
      run: {
        status: "needsFeedback"
      }
    }
  }
};

test("implement CLI parses required and optional implement options", () => {
  const result = parseImplementCliArgs([
    "--issue",
    "73",
    "--prompt",
    ".runs/issue-73/prompt.md",
    "--worktree",
    "C:/repos/worktrees/issue-73",
    "--before-head",
    "abc123before",
    "--runs-dir",
    "custom-runs"
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    issueNumber: 73,
    promptPath: ".runs/issue-73/prompt.md",
    targetWorktreePath: "C:/repos/worktrees/issue-73",
    beforeHead: "abc123before",
    runsDirectory: "custom-runs"
  });
});

test("implement CLI rejects missing required options", () => {
  const missingIssue = parseImplementCliArgs([
    "--prompt",
    "prompt.md",
    "--worktree",
    "worktree",
    "--before-head",
    "abc123"
  ]);
  const missingPrompt = parseImplementCliArgs([
    "--issue",
    "73",
    "--worktree",
    "worktree",
    "--before-head",
    "abc123"
  ]);
  const missingWorktree = parseImplementCliArgs([
    "--issue",
    "73",
    "--prompt",
    "prompt.md",
    "--before-head",
    "abc123"
  ]);
  const missingBeforeHead = parseImplementCliArgs([
    "--issue",
    "73",
    "--prompt",
    "prompt.md",
    "--worktree",
    "worktree"
  ]);

  assert.equal(missingIssue.ok, false);
  assert.match(!missingIssue.ok ? missingIssue.message : "", /--issue is required/);
  assert.equal(missingPrompt.ok, false);
  assert.match(!missingPrompt.ok ? missingPrompt.message : "", /--prompt is required/);
  assert.equal(missingWorktree.ok, false);
  assert.match(
    !missingWorktree.ok ? missingWorktree.message : "",
    /--worktree is required/
  );
  assert.equal(missingBeforeHead.ok, false);
  assert.match(
    !missingBeforeHead.ok ? missingBeforeHead.message : "",
    /--before-head is required/
  );
});

test("implement CLI validates issue numbers", () => {
  const invalidIssue = parseImplementCliArgs([
    "--issue",
    "0",
    "--prompt",
    "prompt.md",
    "--worktree",
    "worktree",
    "--before-head",
    "abc123"
  ]);
  const unsafeIssue = parseImplementCliArgs([
    "--issue",
    "9007199254740992",
    "--prompt",
    "prompt.md",
    "--worktree",
    "worktree",
    "--before-head",
    "abc123"
  ]);

  assert.equal(invalidIssue.ok, false);
  assert.match(!invalidIssue.ok ? invalidIssue.message : "", /positive integer/);
  assert.equal(unsafeIssue.ok, false);
  assert.match(!unsafeIssue.ok ? unsafeIssue.message : "", /positive integer/);
});

test("implement CLI rejects duplicate flags, missing values, unknown options, and positional arguments", () => {
  const duplicate = parseImplementCliArgs([
    "--issue",
    "73",
    "--issue",
    "74",
    "--prompt",
    "prompt.md",
    "--worktree",
    "worktree",
    "--before-head",
    "abc123"
  ]);
  const missingValue = parseImplementCliArgs(["--issue"]);
  const unknown = parseImplementCliArgs([
    "--issue",
    "73",
    "--prompt",
    "prompt.md",
    "--worktree",
    "worktree",
    "--before-head",
    "abc123",
    "--test-command",
    "npm test"
  ]);
  const positional = parseImplementCliArgs([
    "--issue",
    "73",
    "--prompt",
    "prompt.md",
    "--worktree",
    "worktree",
    "--before-head",
    "abc123",
    "extra"
  ]);

  assert.equal(duplicate.ok, false);
  assert.match(!duplicate.ok ? duplicate.message : "", /--issue may only/);
  assert.equal(missingValue.ok, false);
  assert.match(!missingValue.ok ? missingValue.message : "", /requires a value/);
  assert.equal(unknown.ok, false);
  assert.match(!unknown.ok ? unknown.message : "", /Unknown option: --test-command/);
  assert.equal(positional.ok, false);
  assert.match(
    !positional.ok ? positional.message : "",
    /Unexpected positional argument/
  );
});

test("implement CLI runner returns usage failure before invoking workflow", async () => {
  let invoked = false;
  const stderr: string[] = [];

  const exitCode = await runImplementCli(["--issue", "abc"], {
    stderr: (message) => stderr.push(message),
    runImplementIssueWorkflow: async () => {
      invoked = true;
      return successResult;
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(invoked, false);
  assert.match(stderr.join("\n"), /--issue must be a positive integer/);
  assert.match(stderr.join("\n"), /Usage:/);
});

test("implement CLI runner forwards parsed options and workflow dependencies", async () => {
  let capturedOptions: ImplementIssueWorkflowOptions | undefined;
  let capturedDependencies: ImplementIssueWorkflowDependencies | undefined;
  const dependencies: ImplementIssueWorkflowDependencies = {};

  const exitCode = await runImplementCli(
    [
      "--issue",
      "73",
      "--prompt",
      ".runs/issue-73/prompt.md",
      "--worktree",
      "C:/repos/worktrees/issue-73",
      "--before-head",
      "abc123before",
      "--runs-dir",
      ".runs"
    ],
    {
      stdout: () => undefined,
      workflowDependencies: dependencies,
      runImplementIssueWorkflow: async (options, workflowDependencies) => {
        capturedOptions = options;
        capturedDependencies = workflowDependencies;
        return successResult;
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(capturedOptions, {
    issueNumber: 73,
    promptPath: ".runs/issue-73/prompt.md",
    targetWorktreePath: "C:/repos/worktrees/issue-73",
    beforeHead: "abc123before",
    runsDirectory: ".runs"
  });
  assert.equal(capturedDependencies, dependencies);
});

test("implement CLI runner prints concise success output", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runImplementCli(
    [
      "--issue",
      "73",
      "--prompt",
      ".runs/issue-73/prompt.md",
      "--worktree",
      "C:/repos/worktrees/issue-73",
      "--before-head",
      "abc123before"
    ],
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runImplementIssueWorkflow: async () => successResult
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(stdout.join("\n"), formatImplementSuccess(successResult.value));
  assert.match(stdout.join("\n"), /Implemented issue #73: Add implement CLI/);
  assert.match(stdout.join("\n"), /Verification: passed/);
  assert.match(stdout.join("\n"), /Diff: \.runs\/issue-73\/diff\.patch/);
  assert.match(
    stdout.join("\n"),
    /Verification output: \.runs\/issue-73\/verification\.txt/
  );
  assert.match(stdout.join("\n"), /Release: \.runs\/issue-73\/release\.json/);
  assert.match(stdout.join("\n"), /Run artifact: \.runs\/issue-73\/run\.json/);
});

test("implement CLI runner prints workflow failure stage and message", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runImplementCli(
    [
      "--issue",
      "73",
      "--prompt",
      ".runs/issue-73/prompt.md",
      "--worktree",
      "C:/repos/worktrees/issue-73",
      "--before-head",
      "abc123before"
    ],
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runImplementIssueWorkflow: async () => ({
        ok: false,
        error: {
          stage: "verification",
          code: "unknown",
          message: "tests failed"
        }
      })
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout.length, 0);
  assert.match(
    stderr.join("\n"),
    /Implement workflow failed at verification: tests failed/
  );
});
