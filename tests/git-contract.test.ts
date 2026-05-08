import assert from "node:assert/strict";
import test from "node:test";
import type {
  AutomationResult,
  CleanupWorktreeResult,
  CommitResult,
  GetDiffResult,
  GitAutomationClient,
  GitCommandResult,
  GitCommandRunner,
  PushBranchResult,
  StageFilesResult,
  WorktreeDetails
} from "../src/index.js";

const targetRepositoryPath = "C:/repos/agent-workforce";
const targetWorktreePath = "C:/repos/agent-workforce-worktrees/issue-20";

function ok<T>(value: T): AutomationResult<T> {
  return { ok: true, value };
}

test("GitAutomationClient can be satisfied by a typed fake client", async () => {
  const fakeClient: GitAutomationClient = {
    async createWorktree(input) {
      return ok<WorktreeDetails>({
        targetRepositoryPath: input.targetRepositoryPath,
        targetWorktreePath: input.targetWorktreePath,
        branchName: input.branchName
      });
    },
    async stageFiles(input) {
      return ok<StageFilesResult>({
        targetWorktreePath: input.targetWorktreePath,
        files: input.files
      });
    },
    async getDiff(input) {
      return ok<GetDiffResult>({
        targetWorktreePath: input.targetWorktreePath,
        diff: "diff --git a/src/index.ts b/src/index.ts\n"
      });
    },
    async commit(input) {
      assert.equal(input.message, "Add Git automation contract");

      return ok<CommitResult>({
        targetWorktreePath: input.targetWorktreePath,
        commitSha: "abc123"
      });
    },
    async pushBranch(input) {
      return ok<PushBranchResult>({
        targetWorktreePath: input.targetWorktreePath,
        branchName: input.branchName,
        remoteName: input.remoteName ?? "origin"
      });
    },
    async cleanupWorktree(input) {
      return ok<CleanupWorktreeResult>({
        targetRepositoryPath: input.targetRepositoryPath,
        targetWorktreePath: input.targetWorktreePath,
        removed: true
      });
    }
  };

  const worktree = await fakeClient.createWorktree({
    targetRepositoryPath,
    targetWorktreePath,
    branchName: "issue-20-git-contract",
    baseRef: "main"
  });
  const staged = await fakeClient.stageFiles({
    targetWorktreePath,
    files: ["src/git/types.ts", "src/git/client.ts"]
  });
  const diff = await fakeClient.getDiff({
    targetWorktreePath
  });
  const commit = await fakeClient.commit({
    targetWorktreePath,
    message: "Add Git automation contract"
  });
  const push = await fakeClient.pushBranch({
    targetWorktreePath,
    branchName: "issue-20-git-contract",
    remoteName: "origin",
    setUpstream: true
  });
  const cleanup = await fakeClient.cleanupWorktree({
    targetRepositoryPath,
    targetWorktreePath,
    force: true
  });

  assert.equal(worktree.ok && worktree.value.targetRepositoryPath, targetRepositoryPath);
  assert.equal(staged.ok && staged.value.files.length, 2);
  assert.equal(diff.ok && diff.value.diff, "diff --git a/src/index.ts b/src/index.ts\n");
  assert.equal(commit.ok && commit.value.commitSha, "abc123");
  assert.equal(push.ok && push.value.remoteName, "origin");
  assert.equal(cleanup.ok && cleanup.value.removed, true);
});

test("GitCommandRunner can be satisfied without invoking real git", async () => {
  class FakeGitCommandRunner implements GitCommandRunner {
    async run(args: readonly string[]): Promise<GitCommandResult> {
      assert.deepEqual(args, ["status", "--short"]);

      return {
        exitCode: 0,
        stdout: "M src/index.ts\n",
        stderr: ""
      };
    }
  }

  const runner = new FakeGitCommandRunner();
  const result = await runner.run(["status", "--short"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /src\/index\.ts/);
  assert.equal(result.stderr, "");
});
