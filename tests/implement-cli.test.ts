import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    "--runs-dir",
    "custom-runs"
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    issueNumber: 73,
    runsDirectory: "custom-runs"
  });
});

test("implement CLI rejects missing required options", () => {
  const missingIssue = parseImplementCliArgs(["--runs-dir", ".runs"]);

  assert.equal(missingIssue.ok, false);
  assert.match(!missingIssue.ok ? missingIssue.message : "", /--issue is required/);
});

test("implement CLI validates issue numbers", () => {
  const invalidIssue = parseImplementCliArgs(["--issue", "0"]);
  const unsafeIssue = parseImplementCliArgs(["--issue", "9007199254740992"]);

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
    "74"
  ]);
  const missingValue = parseImplementCliArgs(["--issue"]);
  const unknown = parseImplementCliArgs([
    "--issue",
    "73",
    "--prompt",
    "prompt.md"
  ]);
  const positional = parseImplementCliArgs([
    "--issue",
    "73",
    "extra"
  ]);

  assert.equal(duplicate.ok, false);
  assert.match(!duplicate.ok ? duplicate.message : "", /--issue may only/);
  assert.equal(missingValue.ok, false);
  assert.match(!missingValue.ok ? missingValue.message : "", /requires a value/);
  assert.equal(unknown.ok, false);
  assert.match(!unknown.ok ? unknown.message : "", /Unknown option: --prompt/);
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
  const runsDirectory = await createRunArtifact();

  const exitCode = await runImplementCli(
    ["--issue", "73", "--runs-dir", runsDirectory],
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
    promptPath: join(runsDirectory, "issue-73", "prompt.md"),
    targetWorktreePath: "C:/repos/worktrees/issue-73",
    beforeHead: "abc123before",
    runsDirectory
  });
  assert.equal(capturedDependencies, dependencies);
});

test("implement CLI runner derives workflow options from default issue run directory", async () => {
  let capturedOptions: ImplementIssueWorkflowOptions | undefined;
  const root = await mkdtemp(join(tmpdir(), "implement-cli-default-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(root);
    await createRunArtifact(73, undefined, ".runs");

    const exitCode = await runImplementCli(["--issue", "73"], {
      stdout: () => undefined,
      runImplementIssueWorkflow: async (options) => {
        capturedOptions = options;
        return successResult;
      }
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(capturedOptions, {
      issueNumber: 73,
      promptPath: join(".runs", "issue-73", "prompt.md"),
      targetWorktreePath: "C:/repos/worktrees/issue-73",
      beforeHead: "abc123before"
    });
  } finally {
    process.chdir(originalCwd);
  }
});

test("implement CLI runner fails before workflow when run artifact is missing or invalid", async () => {
  const cases = [
    {
      name: "missing",
      setup: async () => mkdtemp(join(tmpdir(), "implement-cli-missing-")),
      expected: /Implement run artifact not found/
    },
    {
      name: "invalid json",
      setup: async () => createRunArtifact(73, "{"),
      expected: /Invalid implement run artifact JSON/
    },
    {
      name: "missing worktreePath",
      setup: async () =>
        createRunArtifact(
          73,
          JSON.stringify({ beforeHead: "abc123before" })
        ),
      expected: /missing required string worktreePath/
    },
    {
      name: "missing beforeHead",
      setup: async () =>
        createRunArtifact(
          73,
          JSON.stringify({ worktreePath: "C:/repos/worktrees/issue-73" })
        ),
      expected: /missing required string beforeHead/
    }
  ];

  for (const runArtifactCase of cases) {
    let invoked = false;
    const stderr: string[] = [];
    const runsDirectory = await runArtifactCase.setup();

    const exitCode = await runImplementCli(
      ["--issue", "73", "--runs-dir", runsDirectory],
      {
        stderr: (message) => stderr.push(message),
        runImplementIssueWorkflow: async () => {
          invoked = true;
          return successResult;
        }
      }
    );

    assert.equal(exitCode, 1, runArtifactCase.name);
    assert.equal(invoked, false, runArtifactCase.name);
    assert.match(stderr.join("\n"), runArtifactCase.expected);
  }
});

test("implement CLI runner prints concise success output", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runsDirectory = await createRunArtifact();

  const exitCode = await runImplementCli(
    ["--issue", "73", "--runs-dir", runsDirectory],
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
  const runsDirectory = await createRunArtifact();

  const exitCode = await runImplementCli(
    ["--issue", "73", "--runs-dir", runsDirectory],
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

async function createRunArtifact(
  issueNumber = 73,
  content = JSON.stringify({
    worktreePath: "C:/repos/worktrees/issue-73",
    beforeHead: "abc123before"
  }),
  runsDirectory?: string
): Promise<string> {
  const artifactRunsDirectory =
    runsDirectory ?? (await mkdtemp(join(tmpdir(), "implement-cli-")));
  const runDirectory = join(artifactRunsDirectory, `issue-${issueNumber}`);
  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, "run.json"), content, "utf8");
  return artifactRunsDirectory;
}
