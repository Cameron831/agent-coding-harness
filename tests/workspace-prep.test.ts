import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareIssueWorkspace,
  type CleanupWorktreeInput,
  type CleanupWorktreeResult,
  type CommitInput,
  type CommitResult,
  type CreateWorktreeInput,
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

const validInput = {
  issueNumber: 42,
  issueTitle: "Add workspace prep helper",
  targetRepositoryPath: "C:/repos/target",
  worktreeParentPath: "C:/repos/worktrees"
};

class FakeGitAutomationClient implements GitAutomationClient {
  readonly fetchRemoteTrackingRefInputs: FetchRemoteTrackingRefInput[] = [];
  readonly createWorktreeInputs: CreateWorktreeInput[] = [];
  readonly calls: string[] = [];

  constructor(
    private readonly createWorktreeResult: GitAutomationResult<WorktreeDetails> = {
      ok: true,
      value: {
        targetRepositoryPath: "C:/repos/target",
        targetWorktreePath: "C:/repos/worktrees/issue-42",
        branchName: "42-add-workspace-prep-helper"
      }
    },
    private readonly fetchRemoteTrackingRefResult: GitAutomationResult<FetchRemoteTrackingRefResult> = {
      ok: true,
      value: {
        targetRepositoryPath: "C:/repos/target",
        remoteName: "origin",
        branchName: "main"
      }
    }
  ) {}

  async fetchRemoteTrackingRef(
    input: FetchRemoteTrackingRefInput
  ): Promise<GitAutomationResult<FetchRemoteTrackingRefResult>> {
    this.calls.push("fetchRemoteTrackingRef");
    this.fetchRemoteTrackingRefInputs.push(input);
    return this.fetchRemoteTrackingRefResult;
  }

  async createWorktree(
    input: CreateWorktreeInput
  ): Promise<GitAutomationResult<WorktreeDetails>> {
    this.calls.push("createWorktree");
    this.createWorktreeInputs.push(input);
    return this.createWorktreeResult;
  }

  async stageFiles(
    _input: StageFilesInput
  ): Promise<GitAutomationResult<StageFilesResult>> {
    throw new Error("stageFiles should not be called by workspace prep tests.");
  }

  async getDiff(
    _input: GetDiffInput
  ): Promise<GitAutomationResult<GetDiffResult>> {
    throw new Error("getDiff should not be called by workspace prep tests.");
  }

  async getHead(
    _input: GetHeadInput
  ): Promise<GitAutomationResult<GetHeadResult>> {
    throw new Error("getHead should not be called by workspace prep tests.");
  }

  async getChangedFiles(
    _input: GetChangedFilesInput
  ): Promise<GitAutomationResult<GetChangedFilesResult>> {
    throw new Error("getChangedFiles should not be called by workspace prep tests.");
  }

  async commit(_input: CommitInput): Promise<GitAutomationResult<CommitResult>> {
    throw new Error("commit should not be called by workspace prep tests.");
  }

  async checkRemoteBranchCommit(): Promise<never> {
    throw new Error(
      "checkRemoteBranchCommit should not be called by workspace prep tests."
    );
  }

  async pushBranch(
    _input: PushBranchInput
  ): Promise<GitAutomationResult<PushBranchResult>> {
    throw new Error("pushBranch should not be called by workspace prep tests.");
  }

  async cleanupWorktree(
    _input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>> {
    throw new Error("cleanupWorktree should not be called by workspace prep tests.");
  }
}

test("prepareIssueWorkspace derives branch name from issue number and title", async () => {
  const gitClient = new FakeGitAutomationClient();

  const result = await prepareIssueWorkspace(validInput, { gitClient });

  assert.equal(result.ok, true);
  assert.equal(
    gitClient.createWorktreeInputs[0]?.branchName,
    "42-add-workspace-prep-helper"
  );
});

test("prepareIssueWorkspace normalizes punctuation, case, and spacing in branch slugs", async () => {
  const gitClient = new FakeGitAutomationClient();

  await prepareIssueWorkspace(
    {
      ...validInput,
      issueTitle: "  Add: WORKSPACE___prep helper!!  "
    },
    { gitClient }
  );

  assert.equal(
    gitClient.createWorktreeInputs[0]?.branchName,
    "42-add-workspace-prep-helper"
  );
});

test("prepareIssueWorkspace derives the issue worktree path from the parent path", async () => {
  const gitClient = new FakeGitAutomationClient();

  await prepareIssueWorkspace(validInput, { gitClient });

  assert.equal(
    gitClient.createWorktreeInputs[0]?.targetWorktreePath,
    "C:/repos/worktrees/issue-42"
  );
});

test("prepareIssueWorkspace passes derived createWorktree input through the Git client", async () => {
  const gitClient = new FakeGitAutomationClient();

  await prepareIssueWorkspace({ ...validInput, baseRef: "origin/main" }, {
    gitClient
  });

  assert.deepEqual(gitClient.createWorktreeInputs, [
    {
      targetRepositoryPath: "C:/repos/target",
      branchName: "42-add-workspace-prep-helper",
      targetWorktreePath: "C:/repos/worktrees/issue-42",
      baseRef: "origin/main"
    }
  ]);
});

test("prepareIssueWorkspace defaults to origin/main when baseRef is omitted", async () => {
  const gitClient = new FakeGitAutomationClient();

  await prepareIssueWorkspace(validInput, { gitClient });

  assert.deepEqual(gitClient.fetchRemoteTrackingRefInputs, [
    {
      targetRepositoryPath: "C:/repos/target",
      remoteName: "origin",
      branchName: "main"
    }
  ]);
  assert.deepEqual(gitClient.createWorktreeInputs, [
    {
      targetRepositoryPath: "C:/repos/target",
      branchName: "42-add-workspace-prep-helper",
      targetWorktreePath: "C:/repos/worktrees/issue-42",
      baseRef: "origin/main"
    }
  ]);
});

test("prepareIssueWorkspace fetches slashy branch base refs before createWorktree", async () => {
  const gitClient = new FakeGitAutomationClient();

  await prepareIssueWorkspace(
    { ...validInput, baseRef: "upstream/release/2026-05-18" },
    { gitClient }
  );

  assert.deepEqual(gitClient.calls, [
    "fetchRemoteTrackingRef",
    "createWorktree"
  ]);
  assert.deepEqual(gitClient.fetchRemoteTrackingRefInputs, [
    {
      targetRepositoryPath: "C:/repos/target",
      remoteName: "upstream",
      branchName: "release/2026-05-18"
    }
  ]);
  assert.equal(
    gitClient.createWorktreeInputs[0]?.baseRef,
    "upstream/release/2026-05-18"
  );
});

test("prepareIssueWorkspace returns the derived branch and worktree path on success", async () => {
  const gitClient = new FakeGitAutomationClient();

  const result = await prepareIssueWorkspace(validInput, { gitClient });

  assert.deepEqual(result, {
    ok: true,
    value: {
      branchName: "42-add-workspace-prep-helper",
      targetWorktreePath: "C:/repos/worktrees/issue-42"
    }
  });
});

test("prepareIssueWorkspace validates input before invoking Git", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["missing issue number", { issueNumber: undefined }],
    ["zero issue number", { issueNumber: 0 }],
    ["fractional issue number", { issueNumber: 1.5 }],
    ["blank issue title", { issueTitle: " " }],
    ["empty title slug", { issueTitle: "!!!" }],
    ["blank target repository path", { targetRepositoryPath: "\t" }],
    ["blank worktree parent path", { worktreeParentPath: "" }],
    ["blank base ref", { baseRef: "\n" }],
    ["bare branch base ref", { baseRef: "main" }],
    ["sha-like base ref", { baseRef: "abc123" }],
    ["refs head base ref", { baseRef: "refs/heads/main" }],
    ["leading slash base ref", { baseRef: "/main" }],
    ["trailing slash base ref", { baseRef: "origin/" }],
    ["empty branch segment base ref", { baseRef: "origin//main" }],
    ["whitespace base ref", { baseRef: "origin/feature branch" }]
  ];

  for (const [caseName, override] of cases) {
    const gitClient = new FakeGitAutomationClient();

    const result = await prepareIssueWorkspace(
      { ...validInput, ...override } as typeof validInput,
      { gitClient }
    );

    assert.equal(result.ok, false, caseName);
    assert.equal(result.ok || result.error.code, "validation_failed", caseName);
    assert.deepEqual(gitClient.fetchRemoteTrackingRefInputs, [], caseName);
    assert.deepEqual(gitClient.createWorktreeInputs, [], caseName);
  }
});

test("prepareIssueWorkspace returns fetch failures without creating a worktree", async () => {
  const fetchFailure: GitAutomationResult<FetchRemoteTrackingRefResult> = {
    ok: false,
    error: {
      code: "unknown",
      message: "fatal: could not fetch"
    }
  };
  const gitClient = new FakeGitAutomationClient(undefined, fetchFailure);

  const result = await prepareIssueWorkspace(validInput, { gitClient });

  assert.equal(result, fetchFailure);
  assert.deepEqual(gitClient.calls, ["fetchRemoteTrackingRef"]);
  assert.deepEqual(gitClient.createWorktreeInputs, []);
});

test("prepareIssueWorkspace propagates Git createWorktree failures unchanged", async () => {
  const gitFailure: GitAutomationResult<WorktreeDetails> = {
    ok: false,
    error: {
      code: "unknown",
      message: "fatal: branch already exists"
    }
  };
  const gitClient = new FakeGitAutomationClient(gitFailure);

  const result = await prepareIssueWorkspace(validInput, { gitClient });

  assert.equal(result, gitFailure);
});
