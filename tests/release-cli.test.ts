import assert from "node:assert/strict";
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
        summary: "Runs release publishing from explicit CLI inputs.",
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
      commitSha: "abc123commit"
    },
    push: {
      targetWorktreePath: "C:/repos/worktrees/issue-74",
      remoteName: "origin",
      branchName: "74-release-cli"
    },
    pullRequest: {
      repository: { owner: "owner", name: "name" },
      pullRequestNumber: 74,
      title: "Add release CLI",
      state: "open",
      url: "https://github.com/owner/name/pull/74",
      head: "74-release-cli",
      base: "main"
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

test("release CLI parses required and optional release options", () => {
  const result = parseReleaseCliArgs([
    "--release",
    ".runs/issue-74/release.json",
    "--target-repo",
    "C:/repos/target",
    "--worktree",
    "C:/repos/worktrees/issue-74",
    "--branch",
    "74-release-cli",
    "--base",
    "main",
    "--run",
    ".runs/issue-74/run.json",
    "--repo",
    "owner/name"
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    releasePath: ".runs/issue-74/release.json",
    targetRepositoryPath: "C:/repos/target",
    targetWorktreePath: "C:/repos/worktrees/issue-74",
    branch: "74-release-cli",
    base: "main",
    runPath: ".runs/issue-74/run.json",
    repository: { owner: "owner", name: "name" }
  });
});

test("release CLI rejects missing required options", () => {
  const missingRelease = parseReleaseCliArgs([
    "--target-repo",
    "repo",
    "--worktree",
    "worktree",
    "--branch",
    "branch",
    "--base",
    "main"
  ]);
  const missingTarget = parseReleaseCliArgs([
    "--release",
    "release.json",
    "--worktree",
    "worktree",
    "--branch",
    "branch",
    "--base",
    "main"
  ]);
  const missingWorktree = parseReleaseCliArgs([
    "--release",
    "release.json",
    "--target-repo",
    "repo",
    "--branch",
    "branch",
    "--base",
    "main"
  ]);
  const missingBranch = parseReleaseCliArgs([
    "--release",
    "release.json",
    "--target-repo",
    "repo",
    "--worktree",
    "worktree",
    "--base",
    "main"
  ]);
  const missingBase = parseReleaseCliArgs([
    "--release",
    "release.json",
    "--target-repo",
    "repo",
    "--worktree",
    "worktree",
    "--branch",
    "branch"
  ]);

  assert.equal(missingRelease.ok, false);
  assert.match(!missingRelease.ok ? missingRelease.message : "", /--release is required/);
  assert.equal(missingTarget.ok, false);
  assert.match(
    !missingTarget.ok ? missingTarget.message : "",
    /--target-repo is required/
  );
  assert.equal(missingWorktree.ok, false);
  assert.match(
    !missingWorktree.ok ? missingWorktree.message : "",
    /--worktree is required/
  );
  assert.equal(missingBranch.ok, false);
  assert.match(!missingBranch.ok ? missingBranch.message : "", /--branch is required/);
  assert.equal(missingBase.ok, false);
  assert.match(!missingBase.ok ? missingBase.message : "", /--base is required/);
});

test("release CLI validates repository owner/name values", () => {
  const invalidRepository = parseReleaseCliArgs([
    "--release",
    "release.json",
    "--target-repo",
    "repo",
    "--worktree",
    "worktree",
    "--branch",
    "branch",
    "--base",
    "main",
    "--repo",
    "owner/name/extra"
  ]);

  assert.equal(invalidRepository.ok, false);
  assert.match(
    !invalidRepository.ok ? invalidRepository.message : "",
    /owner\/name/
  );
  assert.deepEqual(parseReleaseRepository("owner/name"), {
    owner: "owner",
    name: "name"
  });
  assert.throws(() => parseReleaseRepository(" owner/name"), /owner\/name/);
});

test("release CLI rejects duplicate flags, missing values, unknown options, and positional arguments", () => {
  const duplicate = parseReleaseCliArgs([
    "--release",
    "release.json",
    "--release",
    "other.json",
    "--target-repo",
    "repo",
    "--worktree",
    "worktree",
    "--branch",
    "branch",
    "--base",
    "main"
  ]);
  const missingValue = parseReleaseCliArgs(["--release"]);
  const unknown = parseReleaseCliArgs([
    "--release",
    "release.json",
    "--target-repo",
    "repo",
    "--worktree",
    "worktree",
    "--branch",
    "branch",
    "--base",
    "main",
    "--dry-run"
  ]);
  const positional = parseReleaseCliArgs([
    "--release",
    "release.json",
    "--target-repo",
    "repo",
    "--worktree",
    "worktree",
    "--branch",
    "branch",
    "--base",
    "main",
    "extra"
  ]);

  assert.equal(duplicate.ok, false);
  assert.match(!duplicate.ok ? duplicate.message : "", /--release may only/);
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

  const exitCode = await runReleaseCli(["--release", "release.json"], {
    stderr: (message) => stderr.push(message),
    runReleasePublishWorkflow: async () => {
      invoked = true;
      return successResult;
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(invoked, false);
  assert.match(stderr.join("\n"), /--target-repo is required/);
  assert.match(stderr.join("\n"), /Usage:/);
});

test("release CLI runner forwards parsed options and workflow dependencies", async () => {
  let capturedOptions: ReleasePublishWorkflowOptions | undefined;
  let capturedDependencies: ReleasePublishWorkflowDependencies | undefined;
  const dependencies: ReleasePublishWorkflowDependencies = {};

  const exitCode = await runReleaseCli(
    [
      "--release",
      ".runs/issue-74/release.json",
      "--target-repo",
      "C:/repos/target",
      "--worktree",
      "C:/repos/worktrees/issue-74",
      "--branch",
      "74-release-cli",
      "--base",
      "main",
      "--run",
      ".runs/issue-74/run.json",
      "--repo",
      "owner/name"
    ],
    {
      stdout: () => undefined,
      workflowDependencies: dependencies,
      runReleasePublishWorkflow: async (options, workflowDependencies) => {
        capturedOptions = options;
        capturedDependencies = workflowDependencies;
        return successResult;
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(capturedOptions, {
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

test("release CLI runner prints concise success output", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runReleaseCli(
    [
      "--release",
      ".runs/issue-74/release.json",
      "--target-repo",
      "C:/repos/target",
      "--worktree",
      "C:/repos/worktrees/issue-74",
      "--branch",
      "74-release-cli",
      "--base",
      "main"
    ],
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runReleasePublishWorkflow: async () => successResult
    }
  );

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

test("release CLI runner prints workflow failure stage and message", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runReleaseCli(
    [
      "--release",
      ".runs/issue-74/release.json",
      "--target-repo",
      "C:/repos/target",
      "--worktree",
      "C:/repos/worktrees/issue-74",
      "--branch",
      "74-release-cli",
      "--base",
      "main"
    ],
    {
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
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout.length, 0);
  assert.match(
    stderr.join("\n"),
    /Release workflow failed at push: cannot push branch/
  );
});

test("release CLI runner prints validation failure details", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runReleaseCli(
    [
      "--release",
      ".runs/issue-74/release.json",
      "--target-repo",
      "C:/repos/target",
      "--worktree",
      "C:/repos/worktrees/issue-74",
      "--branch",
      "74-release-cli",
      "--base",
      "main"
    ],
    {
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
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout.length, 0);
  assert.match(
    stderr.join("\n"),
    /Release workflow failed at release_validation: Release metadata validation failed/
  );
  assert.match(stderr.join("\n"), /commit_message is required/);
  assert.match(stderr.join("\n"), /pull_request\.title is required/);
});
