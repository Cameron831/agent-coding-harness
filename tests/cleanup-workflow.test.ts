import assert from "node:assert/strict";
import test from "node:test";
import {
  runCleanupIssueWorkspaceWorkflow,
  type CheckRemoteBranchCommitInput,
  type CheckRemoteBranchCommitResult,
  type CleanupWorktreeInput,
  type CleanupWorktreeResult,
  type CommitInput,
  type CommitResult,
  type CreateWorktreeInput,
  type DeleteLocalBranchInput,
  type DeleteLocalBranchResult,
  type FetchRemoteTrackingRefInput,
  type FetchRemoteTrackingRefResult,
  type GetChangedFilesInput,
  type GetChangedFilesResult,
  type GetDiffInput,
  type GetDiffResult,
  type GetHeadInput,
  type GetHeadResult,
  type GitAutomationClient,
  type GitAutomationResult,
  type PushBranchInput,
  type PushBranchResult,
  type StageFilesInput,
  type StageFilesResult,
  type WorktreeDetails
} from "../src/index.js";

const options = {
  issueNumber: 119,
  runPath: ".runs/issue-119/run.json",
  targetRepositoryPath: "C:/repos/target",
  targetWorktreePath: "C:/repos/worktrees/issue-119",
  branch: "119-cleanup-command"
};

class FakeGitClient implements GitAutomationClient {
  readonly events: string[] = [];
  readonly cleanupWorktreeInputs: CleanupWorktreeInput[] = [];
  readonly deleteLocalBranchInputs: DeleteLocalBranchInput[] = [];

  constructor(
    private readonly overrides: {
      cleanupWorktree?: GitAutomationResult<CleanupWorktreeResult>;
      deleteLocalBranch?: GitAutomationResult<DeleteLocalBranchResult>;
    } = {}
  ) {}

  async cleanupWorktree(
    input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>> {
    this.events.push("cleanupWorktree");
    this.cleanupWorktreeInputs.push(input);
    return (
      this.overrides.cleanupWorktree ?? {
        ok: true,
        value: {
          targetRepositoryPath: input.targetRepositoryPath,
          targetWorktreePath: input.targetWorktreePath,
          removed: true
        }
      }
    );
  }

  async deleteLocalBranch(
    input: DeleteLocalBranchInput
  ): Promise<GitAutomationResult<DeleteLocalBranchResult>> {
    this.events.push("deleteLocalBranch");
    this.deleteLocalBranchInputs.push(input);
    return (
      this.overrides.deleteLocalBranch ?? {
        ok: true,
        value: {
          targetRepositoryPath: input.targetRepositoryPath,
          branchName: input.branchName,
          deleted: true
        }
      }
    );
  }

  async createWorktree(): Promise<GitAutomationResult<WorktreeDetails>> {
    throw new Error("createWorktree should not be called by cleanup tests.");
  }

  async fetchRemoteTrackingRef(
    _input: FetchRemoteTrackingRefInput
  ): Promise<GitAutomationResult<FetchRemoteTrackingRefResult>> {
    throw new Error(
      "fetchRemoteTrackingRef should not be called by cleanup tests."
    );
  }

  async stageFiles(): Promise<GitAutomationResult<StageFilesResult>> {
    throw new Error("stageFiles should not be called by cleanup tests.");
  }

  async getDiff(): Promise<GitAutomationResult<GetDiffResult>> {
    throw new Error("getDiff should not be called by cleanup tests.");
  }

  async getHead(): Promise<GitAutomationResult<GetHeadResult>> {
    throw new Error("getHead should not be called by cleanup tests.");
  }

  async getChangedFiles(): Promise<GitAutomationResult<GetChangedFilesResult>> {
    throw new Error("getChangedFiles should not be called by cleanup tests.");
  }

  async commit(): Promise<GitAutomationResult<CommitResult>> {
    throw new Error("commit should not be called by cleanup tests.");
  }

  async checkRemoteBranchCommit(
    _input: CheckRemoteBranchCommitInput
  ): Promise<GitAutomationResult<CheckRemoteBranchCommitResult>> {
    throw new Error(
      "checkRemoteBranchCommit should not be called by cleanup tests."
    );
  }

  async pushBranch(): Promise<GitAutomationResult<PushBranchResult>> {
    throw new Error("pushBranch should not be called by cleanup tests.");
  }
}

test("cleanup workflow removes the worktree before deleting the local branch", async () => {
  const gitClient = new FakeGitClient();

  const result = await runCleanupIssueWorkspaceWorkflow(options, { gitClient });

  assert.equal(result.ok, true);
  assert.deepEqual(gitClient.events, ["cleanupWorktree", "deleteLocalBranch"]);
  assert.deepEqual(gitClient.cleanupWorktreeInputs, [
    {
      targetRepositoryPath: options.targetRepositoryPath,
      targetWorktreePath: options.targetWorktreePath
    }
  ]);
  assert.deepEqual(gitClient.deleteLocalBranchInputs, [
    {
      targetRepositoryPath: options.targetRepositoryPath,
      branchName: options.branch
    }
  ]);
  assert.equal(result.ok && result.value.worktree.removed, true);
  assert.equal(result.ok && result.value.branch.deleted, true);
});

test("cleanup workflow skips branch deletion when worktree cleanup fails", async () => {
  const gitClient = new FakeGitClient({
    cleanupWorktree: {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Target worktree has uncommitted changes."
      }
    }
  });

  const result = await runCleanupIssueWorkspaceWorkflow(options, { gitClient });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "worktree_cleanup");
  assert.match(result.ok ? "" : result.error.message, /uncommitted changes/);
  assert.deepEqual(gitClient.events, ["cleanupWorktree"]);
  assert.deepEqual(gitClient.deleteLocalBranchInputs, []);
});

test("cleanup workflow reports branch deletion failure after worktree cleanup ran", async () => {
  const gitClient = new FakeGitClient({
    deleteLocalBranch: {
      ok: false,
      error: {
        code: "unknown",
        message: "error: The branch is not fully merged."
      }
    }
  });

  const result = await runCleanupIssueWorkspaceWorkflow(options, { gitClient });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "branch_cleanup");
  assert.match(result.ok ? "" : result.error.message, /not fully merged/);
  assert.equal(
    result.ok || result.error.worktreeCleanup?.targetWorktreePath,
    options.targetWorktreePath
  );
  assert.deepEqual(gitClient.events, ["cleanupWorktree", "deleteLocalBranch"]);
});
