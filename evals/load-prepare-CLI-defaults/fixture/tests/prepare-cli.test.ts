import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  formatPrepareSuccess,
  parsePrepareCliArgs,
  parsePrepareRepository,
  runPrepareCli,
  type PrepareWorkflowDependencies,
  type PrepareWorkflowOptions,
  type PrepareWorkflowResult
} from "../src/index.js";

const successResult: PrepareWorkflowResult = {
  ok: true,
  value: {
    issue: {
      repository: { owner: "owner", name: "name" },
      issueNumber: 67,
      title: "Add prepare CLI",
      body: "Create a workflow-local prepare CLI.",
      state: "open",
      url: "https://github.com/owner/name/issues/67"
    },
    promptPath: ".runs/issue-67/prompt.md",
    issuePath: ".runs/issue-67/issue.json",
    runPath: ".runs/issue-67/run.json",
    branchName: "67-add-prepare-cli",
    branch: "67-add-prepare-cli",
    worktreePath: "C:/repos/worktrees/issue-67",
    artifacts: {
      runDirectory: ".runs/issue-67",
      promptPath: ".runs/issue-67/prompt.md",
      issuePath: ".runs/issue-67/issue.json",
      runPath: ".runs/issue-67/run.json",
      issue: {
        number: 67,
        title: "Add prepare CLI",
        body: "Create a workflow-local prepare CLI."
      },
      run: {
        status: "prepared",
        issueURL: "https://github.com/owner/name/issues/67",
        issueTitle: "Add prepare CLI",
        issueNumber: 67,
        worktreePath: "C:/repos/worktrees/issue-67",
        branch: "67-add-prepare-cli",
        beforeHead: "abc123"
      }
    }
  }
};

test("prepare CLI parses required and optional prepare options", () => {
  const result = parsePrepareCliArgs([
    "--issue",
    "67",
    "--target-repo",
    "C:/repos/target",
    "--worktree-parent",
    "C:/repos/worktrees",
    "--repo",
    "owner/name",
    "--base-ref",
    "origin/main",
    "--prompt-variant",
    "with-subagents",
    "--prompts-dir",
    "custom-prompts",
    "--runs-dir",
    "custom-runs"
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    issueNumber: 67,
    targetRepositoryPath: "C:/repos/target",
    worktreeParentPath: "C:/repos/worktrees",
    repository: { owner: "owner", name: "name" },
    baseRef: "origin/main",
    promptVariant: "with-subagents",
    promptsDirectory: "custom-prompts",
    runsDirectory: "custom-runs"
  });
});

test("prepare CLI rejects missing required options", async () => {
  await withTemporaryCwd(async () => {
    const missingIssue = parsePrepareCliArgs([
      "--target-repo",
      "repo",
      "--worktree-parent",
      "worktrees"
    ]);
    const missingTarget = parsePrepareCliArgs([
      "--issue",
      "67",
      "--worktree-parent",
      "worktrees"
    ]);
    const missingWorktreeParent = parsePrepareCliArgs([
      "--issue",
      "67",
      "--target-repo",
      "repo"
    ]);

    assert.equal(missingIssue.ok, false);
    assert.match(
      !missingIssue.ok ? missingIssue.message : "",
      /--issue is required/
    );
    assert.equal(missingTarget.ok, false);
    assert.match(
      !missingTarget.ok ? missingTarget.message : "",
      /--target-repo is required/
    );
    assert.equal(missingWorktreeParent.ok, false);
    assert.match(
      !missingWorktreeParent.ok ? missingWorktreeParent.message : "",
      /--worktree-parent is required/
    );
  });
});

test("prepare CLI loads target repo, worktree parent, and repository defaults from .env", async () => {
  await withTemporaryCwd(async (directory) => {
    writeFileSync(
      join(directory, ".env"),
      [
        "# prepare defaults",
        "",
        "TARGET_REPO_PATH=C:/repos/env-target",
        "WORKTREE_PARENT_PATH=C:/repos/env-worktrees",
        "REPO_SLUG=env-owner/env-name"
      ].join("\n")
    );

    const result = parsePrepareCliArgs(["--issue", "89"]);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.value, {
      issueNumber: 89,
      targetRepositoryPath: "C:/repos/env-target",
      worktreeParentPath: "C:/repos/env-worktrees",
      repository: { owner: "env-owner", name: "env-name" }
    });
  });
});

test("prepare CLI explicit options override .env defaults", async () => {
  await withTemporaryCwd(async (directory) => {
    writeFileSync(
      join(directory, ".env"),
      [
        "TARGET_REPO_PATH=C:/repos/env-target",
        "WORKTREE_PARENT_PATH=C:/repos/env-worktrees",
        "REPO_SLUG=env-owner/env-name"
      ].join("\n")
    );

    const result = parsePrepareCliArgs([
      "--issue",
      "89",
      "--target-repo",
      "C:/repos/cli-target",
      "--worktree-parent",
      "C:/repos/cli-worktrees",
      "--repo",
      "cli-owner/cli-name"
    ]);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.value, {
      issueNumber: 89,
      targetRepositoryPath: "C:/repos/cli-target",
      worktreeParentPath: "C:/repos/cli-worktrees",
      repository: { owner: "cli-owner", name: "cli-name" }
    });
  });
});

test("prepare CLI ignores missing .env files and missing .env values", async () => {
  await withTemporaryCwd(async (directory) => {
    const missingFile = parsePrepareCliArgs(["--issue", "89"]);

    writeFileSync(
      join(directory, ".env"),
      ["# no target defaults", "", "REPO_SLUG=owner/name"].join("\n")
    );
    const missingTarget = parsePrepareCliArgs(["--issue", "89"]);

    writeFileSync(
      join(directory, ".env"),
      ["TARGET_REPO_PATH=C:/repos/env-target", "REPO_SLUG=owner/name"].join(
        "\n"
      )
    );
    const missingWorktreeParent = parsePrepareCliArgs(["--issue", "89"]);

    assert.equal(missingFile.ok, false);
    assert.match(
      !missingFile.ok ? missingFile.message : "",
      /--target-repo is required/
    );
    assert.equal(missingTarget.ok, false);
    assert.match(
      !missingTarget.ok ? missingTarget.message : "",
      /--target-repo is required/
    );
    assert.equal(missingWorktreeParent.ok, false);
    assert.match(
      !missingWorktreeParent.ok ? missingWorktreeParent.message : "",
      /--worktree-parent is required/
    );
  });
});

test("prepare CLI rejects invalid REPO_SLUG defaults", async () => {
  await withTemporaryCwd(async (directory) => {
    writeFileSync(
      join(directory, ".env"),
      [
        "TARGET_REPO_PATH=C:/repos/env-target",
        "WORKTREE_PARENT_PATH=C:/repos/env-worktrees",
        "REPO_SLUG=owner/name/extra"
      ].join("\n")
    );

    const result = parsePrepareCliArgs(["--issue", "89"]);

    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /owner\/name/);
  });
});

test("prepare CLI validates issue numbers, repositories, and prompt variants", () => {
  const invalidIssue = parsePrepareCliArgs([
    "--issue",
    "0",
    "--target-repo",
    "repo",
    "--worktree-parent",
    "worktrees"
  ]);
  const invalidRepository = parsePrepareCliArgs([
    "--issue",
    "67",
    "--target-repo",
    "repo",
    "--worktree-parent",
    "worktrees",
    "--repo",
    "owner/name/extra"
  ]);
  const invalidVariant = parsePrepareCliArgs([
    "--issue",
    "67",
    "--target-repo",
    "repo",
    "--worktree-parent",
    "worktrees",
    "--prompt-variant",
    "verbose"
  ]);

  assert.equal(invalidIssue.ok, false);
  assert.match(!invalidIssue.ok ? invalidIssue.message : "", /positive integer/);
  assert.equal(invalidRepository.ok, false);
  assert.match(
    !invalidRepository.ok ? invalidRepository.message : "",
    /owner\/name/
  );
  assert.equal(invalidVariant.ok, false);
  assert.match(
    !invalidVariant.ok ? invalidVariant.message : "",
    /standard, with-subagents/
  );
});

test("prepare CLI rejects duplicate flags, missing values, unknown options, and positional arguments", () => {
  const duplicate = parsePrepareCliArgs([
    "--issue",
    "67",
    "--issue",
    "68",
    "--target-repo",
    "repo",
    "--worktree-parent",
    "worktrees"
  ]);
  const missingValue = parsePrepareCliArgs(["--issue"]);
  const unknown = parsePrepareCliArgs([
    "--issue",
    "67",
    "--target-repo",
    "repo",
    "--worktree-parent",
    "worktrees",
    "--dry-run"
  ]);
  const positional = parsePrepareCliArgs([
    "--issue",
    "67",
    "--target-repo",
    "repo",
    "--worktree-parent",
    "worktrees",
    "extra"
  ]);

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

test("prepare CLI parses valid repository owner/name values", () => {
  assert.deepEqual(parsePrepareRepository("owner/name"), {
    owner: "owner",
    name: "name"
  });
});

test("prepare CLI runner returns usage failure before invoking workflow", async () => {
  let invoked = false;
  const stderr: string[] = [];

  const exitCode = await runPrepareCli(["--issue", "abc"], {
    stderr: (message) => stderr.push(message),
    runPrepareWorkflow: async () => {
      invoked = true;
      return successResult;
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(invoked, false);
  assert.match(stderr.join("\n"), /--issue must be a positive integer/);
  assert.match(stderr.join("\n"), /Usage:/);
});

test("prepare CLI runner forwards parsed options and workflow dependencies", async () => {
  await withTemporaryCwd(async (directory) => {
    writeFileSync(
      join(directory, ".env"),
      [
        "TARGET_REPO_PATH=C:/repos/target",
        "WORKTREE_PARENT_PATH=C:/repos/worktrees",
        "REPO_SLUG=owner/name"
      ].join("\n")
    );

    let capturedOptions: PrepareWorkflowOptions | undefined;
    let capturedDependencies: PrepareWorkflowDependencies | undefined;
    const dependencies: PrepareWorkflowDependencies = {};

    const exitCode = await runPrepareCli(
      [
        "--issue",
        "67",
        "--base-ref",
        "main",
        "--prompt-variant",
        "standard",
        "--prompts-dir",
        "prompts",
        "--runs-dir",
        ".runs"
      ],
      {
        stdout: () => undefined,
        workflowDependencies: dependencies,
        runPrepareWorkflow: async (options, workflowDependencies) => {
          capturedOptions = options;
          capturedDependencies = workflowDependencies;
          return successResult;
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(capturedOptions, {
      issueNumber: 67,
      targetRepositoryPath: "C:/repos/target",
      worktreeParentPath: "C:/repos/worktrees",
      repository: { owner: "owner", name: "name" },
      baseRef: "main",
      promptVariant: "standard",
      promptsDirectory: "prompts",
      runsDirectory: ".runs"
    });
    assert.equal(capturedDependencies, dependencies);
  });
});

test("prepare CLI runner prints concise success output", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runPrepareCli(
    [
      "--issue",
      "67",
      "--target-repo",
      "C:/repos/target",
      "--worktree-parent",
      "C:/repos/worktrees"
    ],
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runPrepareWorkflow: async () => successResult
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(stdout.join("\n"), formatPrepareSuccess(successResult.value));
  assert.match(stdout.join("\n"), /Prepared issue #67: Add prepare CLI/);
  assert.match(stdout.join("\n"), /Branch: 67-add-prepare-cli/);
  assert.match(stdout.join("\n"), /Worktree: C:\/repos\/worktrees\/issue-67/);
  assert.match(stdout.join("\n"), /Prompt: \.runs\/issue-67\/prompt\.md/);
  assert.match(stdout.join("\n"), /Issue artifact: \.runs\/issue-67\/issue\.json/);
  assert.match(stdout.join("\n"), /Run artifact: \.runs\/issue-67\/run\.json/);
});

test("prepare CLI runner prints workflow failure stage and message", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runPrepareCli(
    [
      "--issue",
      "67",
      "--target-repo",
      "C:/repos/target",
      "--worktree-parent",
      "C:/repos/worktrees"
    ],
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      runPrepareWorkflow: async () => ({
        ok: false,
        error: {
          stage: "workspace_prep",
          code: "unknown",
          message: "branch already exists"
        }
      })
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout.length, 0);
  assert.match(
    stderr.join("\n"),
    /Prepare workflow failed at workspace_prep: branch already exists/
  );
});

async function withTemporaryCwd<T>(
  callback: (directory: string) => T | Promise<T>
): Promise<T> {
  const previousDirectory = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "prepare-cli-"));

  process.chdir(directory);
  try {
    return await callback(directory);
  } finally {
    process.chdir(previousDirectory);
    rmSync(directory, { recursive: true, force: true });
  }
}