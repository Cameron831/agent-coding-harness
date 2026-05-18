import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  formatReleaseSuccess,
  parseReleaseCliArgs,
  parseReleaseRepository,
  runReleaseCli,
  type ReleasePublishWorkflowDependencies,
  type ReleasePublishWorkflowOptions,
  type ReleasePublishWorkflowResult
} from "../src/index.js";

const successResult: ReleasePublishWorkflowResult = {
  ok: true,
  value: {
    releasePath: ".runs/issue-74/release.json",
    runPath: ".runs/issue-74/run.json",
    release: {
      commit_message: "Add release CLI",
      pull_request: {
        title: "Add release CLI",
        summary: "Runs release publishing from issue CLI inputs.",
        scope: ["Added release CLI."],
        verification: ["npm test"]
      }
    },
    changedFiles: {
      targetWorktreePath: "C:/repos/worktrees/issue-74",
      files: ["src/workflow/release/cli-release.ts"]
    },
    staged: {
      targetWorktreePath: "C:/repos/worktrees/issue-74",
      files: ["src/workflow/release/cli-release.ts"]
    },
    commit: {
      targetWorktreePath: "C:/repos/worktrees/issue-74",
      commitSha: "abc123commit",
      reused: false
    },
    push: {
      targetWorktreePath: "C:/repos/worktrees/issue-74",
      remoteName: "origin",
      branchName: "74-release-cli",
      reused: false
    },
    pullRequest: {
      repository: { owner: "owner", name: "name" },
      pullRequestNumber: 74,
      title: "Add release CLI",
      state: "open",
      url: "https://github.com/owner/name/pull/74",
      head: "74-release-cli",
      base: "main",
      reused: false
    },
    cleanup: {
      targetRepositoryPath: "C:/repos/target",
      targetWorktreePath: "C:/repos/worktrees/issue-74",
      removed: true
    },
    artifacts: {
      runPath: ".runs/issue-74/run.json",
      run: {
        status: "published",
        pullRequestURL: "https://github.com/owner/name/pull/74"
      }
    }
  }
};

test("release CLI parses issue option", () => {
  const result = parseReleaseCliArgs(["--issue", "74"]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    issueNumber: 74
  });
});

test("release CLI validates issue numbers and repository owner/name values", () => {
  const invalidIssue = parseReleaseCliArgs(["--issue", "0"]);

  assert.equal(invalidIssue.ok, false);
  assert.match(
    !invalidIssue.ok ? invalidIssue.message : "",
    /positive integer/
  );
  assert.deepEqual(parseReleaseRepository("owner/name"), {
    owner: "owner",
    name: "name"
  });
  assert.throws(() => parseReleaseRepository(" owner/name"), /owner\/name/);
});

test("release CLI rejects missing issue, duplicate flags, missing values, unknown options, and positional arguments", () => {
  const missingIssue = parseReleaseCliArgs([]);
  const duplicate = parseReleaseCliArgs([
    "--issue",
    "74",
    "--issue",
    "75"
  ]);
  const missingValue = parseReleaseCliArgs(["--issue"]);
  const unknown = parseReleaseCliArgs(["--issue", "74", "--dry-run"]);
  const positional = parseReleaseCliArgs(["--issue", "74", "extra"]);

  assert.equal(missingIssue.ok, false);
  assert.match(!missingIssue.ok ? missingIssue.message : "", /--issue is required/);
  assert.equal(duplicate.ok, false);
  assert.match(!duplicate.ok ? duplicate.message : "", /--issue may only/);
  assert.equal(missingValue.ok, false);
  assert.match(!missingValue.ok ? missingValue.message : "", /requires a value/);
  assert.equal(unknown.ok, false);
  assert.match(!unknown.ok ? unknown.message : "", /Unknown option: --dry-run/);
  assert.equal(positional.ok, false);
  assert.match(
    !positional.ok ? positional.message : "",
    /Unexpected positional argument/
  );
});

test("release CLI runner returns usage failure before invoking workflow", async () => {
  let invoked = false;
  const stderr: string[] = [];

  const exitCode = await runReleaseCli(["--issue", "abc"], {
    stderr: (message) => stderr.push(message),
    runReleasePublishWorkflow: async () => {
      invoked = true;
      return successResult;
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(invoked, false);
  assert.match(stderr.join("\n"), /--issue must be a positive integer/);
  assert.match(stderr.join("\n"), /Usage:/);
});

test("release CLI runner forwards resolved options and workflow dependencies", async () => {
  await withTemporaryCwd(async (directory) => {
    writeReleaseRuntimeFiles(directory);

    let capturedOptions: ReleasePublishWorkflowOptions | undefined;
    let capturedDependencies: ReleasePublishWorkflowDependencies | undefined;
    const dependencies: ReleasePublishWorkflowDependencies = {};

    const exitCode = await runReleaseCli(["--issue", "74"], {
      stdout: () => undefined,
      workflowDependencies: dependencies,
      runReleasePublishWorkflow: async (options, workflowDependencies) => {
        capturedOptions = options;
        capturedDependencies = workflowDependencies;
        return successResult;
      }
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(capturedOptions, {
      issueNumber: 74,
      releasePath: ".runs/issue-74/release.json",
      targetRepositoryPath: "C:/repos/target",
      targetWorktreePath: "C:/repos/worktrees/issue-74",
      branch: "74-release-cli",
      base: "main",
      runPath: ".runs/issue-74/run.json",
      repository: { owner: "owner", name: "name" }
    });
    assert.equal(capturedDependencies, dependencies);
  });
});

test("release CLI runner fails before workflow when runtime inputs are missing or invalid", async () => {
  await withTemporaryCwd(async (directory) => {
    await assertRuntimeFailure(directory, /Missing \.env/, () => undefined);
    await assertRuntimeFailure(directory, /TARGET_REPO_PATH is required/, () => {
      writeEnv(directory, {
        REPO_SLUG: "owner/name",
        BASE_REF: "main"
      });
      writeRunJson(directory, {
        worktreePath: "C:/repos/worktrees/issue-74",
        branch: "74-release-cli"
      });
    });
    await assertRuntimeFailure(directory, /BASE_REF is required/, () => {
      writeEnv(directory, {
        TARGET_REPO_PATH: "C:/repos/target",
        REPO_SLUG: "owner/name"
      });
      writeRunJson(directory, {
        worktreePath: "C:/repos/worktrees/issue-74",
        branch: "74-release-cli"
      });
    });
    await assertRuntimeFailure(directory, /REPO_SLUG is required/, () => {
      writeEnv(directory, {
        TARGET_REPO_PATH: "C:/repos/target",
        BASE_REF: "main"
      });
      writeRunJson(directory, {
        worktreePath: "C:/repos/worktrees/issue-74",
        branch: "74-release-cli"
      });
    });
    await assertRuntimeFailure(directory, /Invalid REPO_SLUG.*owner\/name/, () => {
      writeEnv(directory, {
        TARGET_REPO_PATH: "C:/repos/target",
        REPO_SLUG: "owner/name/extra",
        BASE_REF: "main"
      });
      writeRunJson(directory, {
        worktreePath: "C:/repos/worktrees/issue-74",
        branch: "74-release-cli"
      });
    });
    await assertRuntimeFailure(directory, /Missing run artifact/, () => {
      writeEnv(directory);
    });
    await assertRuntimeFailure(directory, /must be valid JSON/, () => {
      writeEnv(directory);
      writeRawRunJson(directory, "{");
    });
    await assertRuntimeFailure(directory, /missing worktreePath/, () => {
      writeEnv(directory);
      writeRunJson(directory, { branch: "74-release-cli" });
    });
    await assertRuntimeFailure(directory, /missing branch/, () => {
      writeEnv(directory);
      writeRunJson(directory, {
        worktreePath: "C:/repos/worktrees/issue-74"
      });
    });
  });
});

test("release CLI runner prints concise success output", async () => {
  await withTemporaryCwd(async (directory) => {
    writeReleaseRuntimeFiles(directory);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runReleaseCli(["--issue", "74"], {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runReleasePublishWorkflow: async () => successResult
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.length, 0);
    assert.equal(stdout.join("\n"), formatReleaseSuccess(successResult.value));
    assert.match(stdout.join("\n"), /Release: \.runs\/issue-74\/release\.json/);
    assert.match(stdout.join("\n"), /Run artifact: \.runs\/issue-74\/run\.json/);
    assert.match(stdout.join("\n"), /Branch: 74-release-cli/);
    assert.match(stdout.join("\n"), /Worktree: C:\/repos\/worktrees\/issue-74/);
    assert.match(stdout.join("\n"), /Commit: abc123commit/);
    assert.match(stdout.join("\n"), /Pushed: origin\/74-release-cli/);
    assert.match(stdout.join("\n"), /Pull request: #74 https:\/\/github\.com\/owner\/name\/pull\/74/);
    assert.match(stdout.join("\n"), /Cleanup: removed/);
  });
});

test("release CLI runner prints workflow failure stage and message", async () => {
  await withTemporaryCwd(async (directory) => {
    writeReleaseRuntimeFiles(directory);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runReleaseCli(["--issue", "74"], {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runReleasePublishWorkflow: async () => ({
        ok: false,
        error: {
          stage: "push",
          code: "unknown",
          message: "cannot push branch"
        }
      })
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.length, 0);
    assert.match(
      stderr.join("\n"),
      /Release workflow failed at push: cannot push branch/
    );
  });
});

test("release CLI runner prints validation failure details", async () => {
  await withTemporaryCwd(async (directory) => {
    writeReleaseRuntimeFiles(directory);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runReleaseCli(["--issue", "74"], {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runReleasePublishWorkflow: async () => ({
        ok: false,
        error: {
          stage: "release_validation",
          code: "validation_failed",
          message: "Release metadata validation failed.",
          errors: [
            {
              field: "commit_message",
              message: "Release metadata field commit_message is required."
            },
            {
              field: "pull_request.title",
              message: "Release metadata field pull_request.title is required."
            }
          ]
        }
      })
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.length, 0);
    assert.match(
      stderr.join("\n"),
      /Release workflow failed at release_validation: Release metadata validation failed/
    );
    assert.match(stderr.join("\n"), /commit_message is required/);
    assert.match(stderr.join("\n"), /pull_request\.title is required/);
  });
});

async function withTemporaryCwd<T>(
  callback: (directory: string) => T | Promise<T>
): Promise<T> {
  const previousDirectory = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "release-cli-"));

  process.chdir(directory);
  try {
    return await callback(directory);
  } finally {
    process.chdir(previousDirectory);
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeReleaseRuntimeFiles(directory: string): void {
  writeEnv(directory);
  writeRunJson(directory, {
    worktreePath: "C:/repos/worktrees/issue-74",
    branch: "74-release-cli"
  });
}

function writeEnv(
  directory: string,
  values: Record<string, string> = {
    TARGET_REPO_PATH: "C:/repos/target",
    REPO_SLUG: "owner/name",
    BASE_REF: "main"
  }
): void {
  writeFileSync(
    join(directory, ".env"),
    [
      "# release defaults",
      "",
      ...Object.entries(values).map(([key, value]) => `${key}=${value}`)
    ].join("\n")
  );
}

function writeRunJson(directory: string, value: Record<string, unknown>): void {
  writeRawRunJson(directory, JSON.stringify(value));
}

function writeRawRunJson(directory: string, contents: string): void {
  const runDirectory = join(directory, ".runs", "issue-74");
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
  const exitCode = await runReleaseCli(["--issue", "74"], {
    stderr: (message) => stderr.push(message),
    runReleasePublishWorkflow: async () => {
      invoked = true;
      return successResult;
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(invoked, false);
  assert.match(stderr.join("\n"), expectedMessage);
}
