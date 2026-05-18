import assert from "node:assert/strict";
import test from "node:test";
import type {
  AutomationResult,
  CheckRemoteBranchCommitResult,
  CleanupWorktreeResult,
  CommitResult,
  GetChangedFilesResult,
  GetDiffResult,
  GetHeadResult,
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
    async getHead(input) {
      return ok<GetHeadResult>({
        targetWorktreePath: input.targetWorktreePath,
        head: "abc123"
      });
    },
    async getChangedFiles(input) {
      return ok<GetChangedFilesResult>({
        targetWorktreePath: input.targetWorktreePath,
        files: ["src/index.ts"]
      });
    },
    async commit(input) {
      assert.equal(input.message, "Add Git automation contract");

      return ok<CommitResult>({
        targetWorktreePath: input.targetWorktreePath,
        commitSha: "abc123"
      });
    },
    async checkRemoteBranchCommit(input) {
      return ok<CheckRemoteBranchCommitResult>({
        targetWorktreePath: input.targetWorktreePath,
        branchName: input.branchName,
        remoteName: input.remoteName ?? "origin",
        expectedCommit: input.expectedCommit,
        status: "matches",
        actualCommit: input.expectedCommit
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
  const head = await fakeClient.getHead({
    targetWorktreePath
  });
  const changedFiles = await fakeClient.getChangedFiles({
    targetWorktreePath
  });
  const commit = await fakeClient.commit({
    targetWorktreePath,
    message: "Add Git automation contract"
  });
  const remoteBranch = await fakeClient.checkRemoteBranchCommit({
    targetWorktreePath,
    branchName: "issue-20-git-contract",
    remoteName: "origin",
    expectedCommit: "abc123"
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
  assert.equal(head.ok && head.value.head, "abc123");
  assert.deepEqual(changedFiles.ok && changedFiles.value.files, ["src/index.ts"]);
  assert.equal(commit.ok && commit.value.commitSha, "abc123");
  assert.equal(remoteBranch.ok && remoteBranch.value.status, "matches");
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
