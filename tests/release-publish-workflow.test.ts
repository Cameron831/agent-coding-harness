import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  renderReleasePullRequestBody,
  runReleasePublishWorkflow,
  updateRunStatus,
  writePullRequestRunArtifact,
  type AutomationResult,
  type CleanupWorktreeInput,
  type CleanupWorktreeResult,
  type CheckRemoteBranchCommitInput,
  type CheckRemoteBranchCommitResult,
  type CloseIssueInput,
  type CommitInput,
  type CommitResult,
  type CreateIssueInput,
  type CreatePullRequestInput,
  type CreateWorktreeInput,
  type GetChangedFilesInput,
  type GetChangedFilesResult,
  type GetDiffInput,
  type GetDiffResult,
  type GetHeadInput,
  type GetHeadResult,
  type GitAutomationClient,
  type GitAutomationError,
  type GitAutomationResult,
  type GitHubAutomationClient,
  type GitHubAutomationError,
  type ImplementorReleaseMetadata,
  type IssueDetails,
  type IssueIdentifier,
  type ListOpenPullRequestsInput,
  type PushBranchInput,
  type PushBranchResult,
  type PullRequestDetails,
  type StageFilesInput,
  type StageFilesResult,
  type WorktreeDetails
} from "../src/index.js";

const release: ImplementorReleaseMetadata = {
  commit_message: "Publish release workflow",
  pull_request: {
    title: "Publish release workflow",
    summary: "Adds the release publishing workflow.",
    scope: ["Stage changed files.", "Commit, push, open a PR, and clean up."],
    verification: ["npm test"]
  }
};

const callerWorktreePath = "C:/repos/worktrees/issue-70";
const callerBranch = "70-release-publish-workflow";

const run = {
  status: "approvedPublishing",
  issueURL: "https://github.com/owner/name/issues/70",
  issueTitle: "Add release publish workflow",
  issueNumber: 70,
  worktreePath: callerWorktreePath,
  branch: callerBranch,
  beforeHead: "abc123before"
};

const options = {
  issueNumber: 70,
  releasePath: "release.json",
  runPath: "run.json",
  targetWorktreePath: callerWorktreePath,
  branch: callerBranch,
  targetRepositoryPath: "C:/repos/target",
  repository: { owner: "owner", name: "name" },
  base: "main"
};

class FakeGitClient implements GitAutomationClient {
  readonly getChangedFilesInputs: GetChangedFilesInput[] = [];
  readonly getHeadInputs: GetHeadInput[] = [];
  readonly stageFilesInputs: StageFilesInput[] = [];
  readonly commitInputs: CommitInput[] = [];
  readonly checkRemoteBranchCommitInputs: CheckRemoteBranchCommitInput[] = [];
  readonly pushBranchInputs: PushBranchInput[] = [];
  readonly cleanupWorktreeInputs: CleanupWorktreeInput[] = [];

  constructor(
    private readonly events: string[],
    private readonly overrides: {
      changedFiles?: GitAutomationResult<GetChangedFilesResult>;
      head?: GitAutomationResult<GetHeadResult>;
      stageFiles?: GitAutomationResult<StageFilesResult>;
      commit?: GitAutomationResult<CommitResult>;
      remoteBranch?: GitAutomationResult<CheckRemoteBranchCommitResult>;
      pushBranch?: GitAutomationResult<PushBranchResult>;
      cleanupWorktree?: GitAutomationResult<CleanupWorktreeResult>;
    } = {}
  ) {}

  async createWorktree(
    _input: CreateWorktreeInput
  ): Promise<GitAutomationResult<WorktreeDetails>> {
    throw new Error("createWorktree should not be called by release publish tests.");
  }

  async stageFiles(
    input: StageFilesInput
  ): Promise<GitAutomationResult<StageFilesResult>> {
    this.events.push("stageFiles");
    this.stageFilesInputs.push(input);
    return (
      this.overrides.stageFiles ?? {
        ok: true,
        value: {
          targetWorktreePath: input.targetWorktreePath,
          files: input.files
        }
      }
    );
  }

  async getDiff(_input: GetDiffInput): Promise<GitAutomationResult<GetDiffResult>> {
    throw new Error("getDiff should not be called by release publish tests.");
  }

  async getHead(input: GetHeadInput): Promise<GitAutomationResult<GetHeadResult>> {
    this.events.push("getHead");
    this.getHeadInputs.push(input);
    return (
      this.overrides.head ?? {
        ok: true,
        value: {
          targetWorktreePath: input.targetWorktreePath,
          head: run.beforeHead
        }
      }
    );
  }

  async getChangedFiles(
    input: GetChangedFilesInput
  ): Promise<GitAutomationResult<GetChangedFilesResult>> {
    this.events.push("getChangedFiles");
    this.getChangedFilesInputs.push(input);
    return (
      this.overrides.changedFiles ?? {
        ok: true,
        value: {
          targetWorktreePath: input.targetWorktreePath,
          files: ["src/workflow/release/publish.ts", "src/index.ts"]
        }
      }
    );
  }

  async commit(input: CommitInput): Promise<GitAutomationResult<CommitResult>> {
    this.events.push("commit");
    this.commitInputs.push(input);
    return (
      this.overrides.commit ?? {
        ok: true,
        value: {
          targetWorktreePath: input.targetWorktreePath,
          commitSha: "commit123"
        }
      }
    );
  }

  async checkRemoteBranchCommit(
    input: CheckRemoteBranchCommitInput
  ): Promise<GitAutomationResult<CheckRemoteBranchCommitResult>> {
    this.events.push("checkRemoteBranchCommit");
    this.checkRemoteBranchCommitInputs.push(input);
    return (
      this.overrides.remoteBranch ?? {
        ok: true,
        value: {
          targetWorktreePath: input.targetWorktreePath,
          branchName: input.branchName,
          remoteName: input.remoteName ?? "origin",
          expectedCommit: input.expectedCommit,
          status: "missing"
        }
      }
    );
  }

  async pushBranch(
    input: PushBranchInput
  ): Promise<GitAutomationResult<PushBranchResult>> {
    this.events.push("pushBranch");
    this.pushBranchInputs.push(input);
    return (
      this.overrides.pushBranch ?? {
        ok: true,
        value: {
          targetWorktreePath: input.targetWorktreePath,
          branchName: input.branchName,
          remoteName: input.remoteName ?? "origin"
        }
      }
    );
  }

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
}

class FakeGitHubClient implements GitHubAutomationClient {
  readonly listOpenPullRequestsInputs: ListOpenPullRequestsInput[] = [];
  readonly createPullRequestInputs: CreatePullRequestInput[] = [];

  constructor(
    private readonly events: string[],
    private readonly result: AutomationResult<PullRequestDetails> = {
      ok: true,
      value: {
        repository: options.repository,
        pullRequestNumber: 70,
        title: release.pull_request.title,
        state: "open",
        url: "https://github.com/owner/name/pull/70",
        base: options.base,
        head: callerBranch,
        body: renderReleasePullRequestBody(release)
      }
    },
    private readonly listResult: AutomationResult<PullRequestDetails[]> = {
      ok: true,
      value: []
    }
  ) {}

  async createIssue(
    _input: CreateIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("createIssue should not be called by release publish tests.");
  }

  async getIssue(
    _input: IssueIdentifier
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("getIssue should not be called by release publish tests.");
  }

  async closeIssue(
    _input: CloseIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("closeIssue should not be called by release publish tests.");
  }

  async listOpenPullRequests(
    input: ListOpenPullRequestsInput
  ): Promise<AutomationResult<PullRequestDetails[]>> {
    this.events.push("listOpenPullRequests");
    this.listOpenPullRequestsInputs.push(input);
    return this.listResult;
  }

  async createPullRequest(
    input: CreatePullRequestInput
  ): Promise<AutomationResult<PullRequestDetails>> {
    this.events.push("createPullRequest");
    this.createPullRequestInputs.push(input);
    return this.result;
  }
}

test("release publish workflow commits, pushes, creates PR, cleans up, and writes published state", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];
    const gitClient = new FakeGitClient(events);
    const githubClient = new FakeGitHubClient(events);

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath },
      {
        gitClient,
        githubClient,
        updateRunStatus: async (input) => {
          events.push(`updateRunStatus:${input.status}`);
          return updateRunStatus(input);
        },
        writePullRequestRunArtifact: async (input) => {
          events.push("writePullRequest");
          return writePullRequestRunArtifact(input);
        }
      }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(events, [
      "updateRunStatus:publishing",
      "getChangedFiles",
      "getHead",
      "stageFiles",
      "commit",
      "checkRemoteBranchCommit",
      "pushBranch",
      "listOpenPullRequests",
      "createPullRequest",
      "writePullRequest",
      "updateRunStatus:published",
      "cleanupWorktree"
    ]);
    assert.deepEqual(gitClient.getChangedFilesInputs, [
      { targetWorktreePath: callerWorktreePath }
    ]);
    assert.deepEqual(gitClient.getHeadInputs, [
      { targetWorktreePath: callerWorktreePath }
    ]);
    assert.deepEqual(gitClient.stageFilesInputs, [
      {
        targetWorktreePath: callerWorktreePath,
        files: ["src/workflow/release/publish.ts", "src/index.ts"]
      }
    ]);
    assert.deepEqual(gitClient.commitInputs, [
      {
        targetWorktreePath: callerWorktreePath,
        message: release.commit_message
      }
    ]);
    assert.deepEqual(gitClient.checkRemoteBranchCommitInputs, [
      {
        targetWorktreePath: callerWorktreePath,
        branchName: callerBranch,
        expectedCommit: "commit123"
      }
    ]);
    assert.deepEqual(gitClient.pushBranchInputs, [
      {
        targetWorktreePath: callerWorktreePath,
        branchName: callerBranch,
        setUpstream: true
      }
    ]);
    assert.deepEqual(githubClient.createPullRequestInputs, [
      {
        repository: options.repository,
        title: release.pull_request.title,
        body: renderReleasePullRequestBody(release),
        base: options.base,
        head: callerBranch,
        linkedIssueNumber: 70
      }
    ]);
    assert.deepEqual(githubClient.listOpenPullRequestsInputs, [
      {
        repository: options.repository,
        base: options.base,
        head: callerBranch
      }
    ]);
    assert.deepEqual(gitClient.cleanupWorktreeInputs, [
      {
        targetRepositoryPath: options.targetRepositoryPath,
        targetWorktreePath: callerWorktreePath
      }
    ]);

    const persistedRun = JSON.parse(await readFile(runPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(persistedRun.status, "published");
    assert.equal(persistedRun.pullRequestURL, "https://github.com/owner/name/pull/70");
    assert.equal(persistedRun.commitSha, undefined);
    assert.equal(persistedRun.pullRequestNumber, undefined);
    assert.equal(persistedRun.cleanup, undefined);

    assert.equal(result.ok && result.value.commit?.commitSha, "commit123");
    assert.equal(result.ok && result.value.commit?.reused, false);
    assert.equal(result.ok && result.value.push?.branchName, callerBranch);
    assert.equal(result.ok && result.value.push?.reused, false);
    assert.equal(result.ok && result.value.pullRequest.pullRequestNumber, 70);
    assert.equal(result.ok && result.value.pullRequest.reused, false);
    assert.equal(
      result.ok && result.value.pullRequest.url,
      "https://github.com/owner/name/pull/70"
    );
    assert.equal(result.ok && result.value.cleanup.removed, true);

  });
});

test("release publish workflow defaults to the run artifact beside release.json", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath: undefined },
      {
        gitClient: new FakeGitClient(events),
        githubClient: new FakeGitHubClient(events)
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.runPath, runPath);
  });
});

test("published run with PR URL retries cleanup only", async () => {
  await withReleaseArtifacts(
    async (_root, releasePath, runPath) => {
      const events: string[] = [];
      const gitClient = new FakeGitClient(events);
      const githubClient = new FakeGitHubClient(events);

      const result = await runReleasePublishWorkflow(
        { ...options, releasePath, runPath },
        {
          gitClient,
          githubClient,
          loadRelease: async () => {
            throw new Error("release should not be loaded");
          },
          updateRunStatus: async (input) => {
            events.push(`updateRunStatus:${input.status}`);
            return updateRunStatus(input);
          },
          writePullRequestRunArtifact: async (input) => {
            events.push("writePullRequest");
            return writePullRequestRunArtifact(input);
          }
        }
      );

      assert.equal(result.ok, true);
      assert.deepEqual(events, ["cleanupWorktree"]);
      assert.deepEqual(gitClient.stageFilesInputs, []);
      assert.deepEqual(gitClient.commitInputs, []);
      assert.deepEqual(gitClient.pushBranchInputs, []);
      assert.deepEqual(githubClient.listOpenPullRequestsInputs, []);
      assert.deepEqual(githubClient.createPullRequestInputs, []);
      assert.equal(result.ok && result.value.commit, undefined);
      assert.equal(result.ok && result.value.push, undefined);
      assert.equal(
        result.ok && result.value.pullRequest.url,
        "https://github.com/owner/name/pull/70"
      );
      assert.equal(result.ok && result.value.pullRequest.reused, true);

      const persistedRun = JSON.parse(await readFile(runPath, "utf8")) as Record<
        string,
        unknown
      >;
      assert.equal(persistedRun.status, "published");
      assert.equal(
        persistedRun.pullRequestURL,
        "https://github.com/owner/name/pull/70"
      );
    },
    {
      ...run,
      status: "published",
      pullRequestURL: "https://github.com/owner/name/pull/70"
    }
  );
});

test("published cleanup failure remains retryable without publication side effects", async () => {
  await withReleaseArtifacts(
    async (_root, releasePath, runPath) => {
      const events: string[] = [];
      const gitClient = new FakeGitClient(events, {
        cleanupWorktree: {
          ok: false,
          error: gitError("worktree still dirty")
        }
      });
      const githubClient = new FakeGitHubClient(events);

      const result = await runReleasePublishWorkflow(
        { ...options, releasePath, runPath },
        {
          gitClient,
          githubClient,
          loadRelease: async () => {
            throw new Error("release should not be loaded");
          },
          updateRunStatus: async (input) => {
            events.push(`updateRunStatus:${input.status}`);
            return updateRunStatus(input);
          },
          writePullRequestRunArtifact: async (input) => {
            events.push("writePullRequest");
            return writePullRequestRunArtifact(input);
          }
        }
      );

      assert.equal(result.ok, false);
      assert.equal(result.ok || result.error.stage, "cleanup");
      assert.deepEqual(events, ["cleanupWorktree"]);
      assert.deepEqual(gitClient.stageFilesInputs, []);
      assert.deepEqual(gitClient.commitInputs, []);
      assert.deepEqual(gitClient.pushBranchInputs, []);
      assert.deepEqual(githubClient.listOpenPullRequestsInputs, []);
      assert.deepEqual(githubClient.createPullRequestInputs, []);

      const persistedRun = JSON.parse(await readFile(runPath, "utf8")) as Record<
        string,
        unknown
      >;
      assert.equal(persistedRun.status, "published");
      assert.equal(
        persistedRun.pullRequestURL,
        "https://github.com/owner/name/pull/70"
      );
    },
    {
      ...run,
      status: "published",
      pullRequestURL: "https://github.com/owner/name/pull/70"
    }
  );
});

test("invalid release metadata fails before run artifact mutation", async () => {
  let publishingWritten = false;

  const result = await runReleasePublishWorkflow(options, {
    loadRunArtifact: async () => run,
    loadRelease: async () => ({
      ok: false,
      errors: [{ message: "Release metadata field commit_message is required." }]
    }),
    updateRunStatus: async () => {
      publishingWritten = true;
      return { runPath: options.runPath, run };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "release_validation");
  assert.equal(publishingWritten, false);
});

test("malformed run artifact fails before Git or GitHub mutation", async () => {
  const cases = [
    {
      name: "malformed JSON",
      contents: "{",
      expectedMessage: /valid JSON/
    },
    {
      name: "non-object JSON",
      contents: "[]",
      expectedMessage: /JSON object/
    }
  ];

  for (const runCase of cases) {
    await withRawRunArtifact(runCase.contents, async (releasePath, runPath) => {
      const events: string[] = [];
      const gitClient = new FakeGitClient(events);
      const githubClient = new FakeGitHubClient(events);

      const result = await runReleasePublishWorkflow(
        { ...options, releasePath, runPath },
        {
          gitClient,
          githubClient,
          updateRunStatus: async (input) => {
            events.push(`updateRunStatus:${input.status}`);
            return updateRunStatus(input);
          }
        }
      );

      assert.equal(result.ok, false, runCase.name);
      assert.equal(result.ok || result.error.stage, "run_validation", runCase.name);
      assert.match(result.ok ? "" : result.error.message, runCase.expectedMessage);
      assert.deepEqual(events, [], runCase.name);
      assert.deepEqual(gitClient.stageFilesInputs, [], runCase.name);
      assert.deepEqual(gitClient.commitInputs, [], runCase.name);
      assert.deepEqual(gitClient.pushBranchInputs, [], runCase.name);
      assert.deepEqual(githubClient.listOpenPullRequestsInputs, [], runCase.name);
      assert.deepEqual(githubClient.createPullRequestInputs, [], runCase.name);
    });
  }
});

test("missing beforeHead fails before publishing reconciliation", async () => {
  const cases: Record<string, unknown>[] = [
    {
      ...run,
      beforeHead: undefined
    },
    {
      ...run,
      status: "published",
      pullRequestURL: " ",
      beforeHead: undefined
    }
  ];

  for (const runArtifact of cases) {
    await withReleaseArtifacts(async (_root, releasePath, runPath) => {
      const events: string[] = [];
      const gitClient = new FakeGitClient(events);

      const result = await runReleasePublishWorkflow(
        { ...options, releasePath, runPath },
        {
          gitClient,
          githubClient: new FakeGitHubClient(events),
          updateRunStatus: async (input) => {
            events.push(`updateRunStatus:${input.status}`);
            return updateRunStatus(input);
          }
        }
      );

      assert.equal(result.ok, false);
      assert.equal(result.ok || result.error.stage, "run_validation");
      assert.match(result.ok ? "" : result.error.message, /beforeHead/);
      assert.deepEqual(events, []);
      assert.deepEqual(gitClient.cleanupWorktreeInputs, []);
    }, runArtifact);
  }
});

test("no changed files and unchanged HEAD fails at staging before commit and cleanup", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];
    const gitClient = new FakeGitClient(events, {
      changedFiles: {
        ok: true,
        value: {
          targetWorktreePath: callerWorktreePath,
          files: []
        }
      }
    });

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath },
      {
        gitClient,
        githubClient: new FakeGitHubClient(events),
        updateRunStatus: async (input) => {
          events.push(`updateRunStatus:${input.status}`);
          return updateRunStatus(input);
        }
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok || result.error.stage, "staging");
    assert.match(
      result.ok ? "" : result.error.message,
      /current HEAD matches the recorded beforeHead/
    );
    assert.deepEqual(events, [
      "updateRunStatus:publishing",
      "getChangedFiles",
      "getHead"
    ]);
    assert.deepEqual(gitClient.stageFilesInputs, []);
    assert.deepEqual(gitClient.commitInputs, []);
    assert.deepEqual(gitClient.cleanupWorktreeInputs, []);
  });
});

test("release publish workflow reuses an existing local release commit", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];
    const gitClient = new FakeGitClient(events, {
      changedFiles: {
        ok: true,
        value: {
          targetWorktreePath: callerWorktreePath,
          files: []
        }
      },
      head: {
        ok: true,
        value: {
          targetWorktreePath: callerWorktreePath,
          head: "commit123"
        }
      }
    });
    const githubClient = new FakeGitHubClient(events);

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath },
      {
        gitClient,
        githubClient,
        updateRunStatus: async (input) => {
          events.push(`updateRunStatus:${input.status}`);
          return updateRunStatus(input);
        },
        writePullRequestRunArtifact: async (input) => {
          events.push("writePullRequest");
          return writePullRequestRunArtifact(input);
        }
      }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(events, [
      "updateRunStatus:publishing",
      "getChangedFiles",
      "getHead",
      "checkRemoteBranchCommit",
      "pushBranch",
      "listOpenPullRequests",
      "createPullRequest",
      "writePullRequest",
      "updateRunStatus:published",
      "cleanupWorktree"
    ]);
    assert.deepEqual(gitClient.stageFilesInputs, []);
    assert.deepEqual(gitClient.commitInputs, []);
    assert.equal(result.ok && result.value.commit?.commitSha, "commit123");
    assert.equal(result.ok && result.value.commit?.reused, true);
  });
});

test("release publish workflow skips push when the remote branch already has the release commit", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];
    const gitClient = new FakeGitClient(events, {
      remoteBranch: {
        ok: true,
        value: {
          targetWorktreePath: callerWorktreePath,
          branchName: callerBranch,
          remoteName: "origin",
          expectedCommit: "commit123",
          status: "matches",
          actualCommit: "commit123"
        }
      }
    });

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath },
      {
        gitClient,
        githubClient: new FakeGitHubClient(events),
        updateRunStatus: async (input) => {
          events.push(`updateRunStatus:${input.status}`);
          return updateRunStatus(input);
        },
        writePullRequestRunArtifact: async (input) => {
          events.push("writePullRequest");
          return writePullRequestRunArtifact(input);
        }
      }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(gitClient.pushBranchInputs, []);
    assert.equal(result.ok && result.value.push?.reused, true);
    assert.equal(result.ok && result.value.push?.branchName, callerBranch);
    assert.deepEqual(events, [
      "updateRunStatus:publishing",
      "getChangedFiles",
      "getHead",
      "stageFiles",
      "commit",
      "checkRemoteBranchCommit",
      "listOpenPullRequests",
      "createPullRequest",
      "writePullRequest",
      "updateRunStatus:published",
      "cleanupWorktree"
    ]);
  });
});

test("release publish workflow reuses exactly one matching open pull request", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];
    const githubClient = new FakeGitHubClient(
      events,
      undefined,
      {
        ok: true,
        value: [
          {
            repository: options.repository,
            pullRequestNumber: 71,
            title: "Existing release PR",
            state: "open",
            url: "https://github.com/owner/name/pull/71",
            base: options.base,
            head: callerBranch
          }
        ]
      }
    );

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath },
      {
        gitClient: new FakeGitClient(events),
        githubClient,
        updateRunStatus: async (input) => {
          events.push(`updateRunStatus:${input.status}`);
          return updateRunStatus(input);
        },
        writePullRequestRunArtifact: async (input) => {
          events.push("writePullRequest");
          return writePullRequestRunArtifact(input);
        }
      }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(githubClient.createPullRequestInputs, []);
    assert.equal(result.ok && result.value.pullRequest.pullRequestNumber, 71);
    assert.equal(result.ok && result.value.pullRequest.reused, true);

    const persistedRun = JSON.parse(await readFile(runPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(persistedRun.pullRequestURL, "https://github.com/owner/name/pull/71");
  });
});

test("multiple matching open pull requests fail before PR creation", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];
    const gitClient = new FakeGitClient(events);
    const githubClient = new FakeGitHubClient(
      events,
      undefined,
      {
        ok: true,
        value: [
          {
            repository: options.repository,
            pullRequestNumber: 71,
            title: "Existing release PR",
            state: "open",
            url: "https://github.com/owner/name/pull/71",
            base: options.base,
            head: callerBranch
          },
          {
            repository: options.repository,
            pullRequestNumber: 72,
            title: "Duplicate release PR",
            state: "open",
            url: "https://github.com/owner/name/pull/72",
            base: options.base,
            head: callerBranch
          }
        ]
      }
    );

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath },
      {
        gitClient,
        githubClient,
        updateRunStatus: async (input) => {
          events.push(`updateRunStatus:${input.status}`);
          return updateRunStatus(input);
        }
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok || result.error.stage, "pr_creation");
    assert.match(result.ok ? "" : result.error.message, /Multiple open pull requests/);
    assert.deepEqual(githubClient.createPullRequestInputs, []);
    assert.deepEqual(gitClient.cleanupWorktreeInputs, []);

    const persistedRun = JSON.parse(await readFile(runPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(persistedRun.status, "publishing");
    assert.equal(persistedRun.pullRequestURL, undefined);
  });
});

test("release publish workflow uses caller-supplied branch and worktree path", async () => {
  await withReleaseArtifacts(
    async (_root, releasePath, runPath) => {
      const events: string[] = [];
      const gitClient = new FakeGitClient(events);
      const githubClient = new FakeGitHubClient(events);

      const result = await runReleasePublishWorkflow(
        {
          ...options,
          releasePath,
          runPath,
          targetWorktreePath: "C:/caller/worktree",
          branch: "caller-branch"
        },
        {
          gitClient,
          githubClient
        }
      );

      assert.equal(result.ok, true);
      assert.deepEqual(gitClient.getChangedFilesInputs, [
        { targetWorktreePath: "C:/caller/worktree" }
      ]);
      assert.deepEqual(gitClient.pushBranchInputs, [
        {
          targetWorktreePath: "C:/caller/worktree",
          branchName: "caller-branch",
          setUpstream: true
        }
      ]);
      assert.equal(githubClient.createPullRequestInputs[0]?.head, "caller-branch");
      assert.deepEqual(gitClient.cleanupWorktreeInputs, [
        {
          targetRepositoryPath: options.targetRepositoryPath,
          targetWorktreePath: "C:/caller/worktree"
        }
      ]);
    },
    {
      ...run,
      status: "not-publishable",
      worktreePath: "C:/run/worktree",
      branch: "run-branch"
    }
  );
});

test("publishing artifact write failure stops before Git or GitHub mutation", async () => {
  const events: string[] = [];

  const result = await runReleasePublishWorkflow(options, {
    loadRunArtifact: async () => run,
    loadRelease: async () => ({ ok: true, value: release }),
    gitClient: new FakeGitClient(events),
    githubClient: new FakeGitHubClient(events),
    updateRunStatus: async () => {
      throw new Error("cannot write run");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.match(result.ok ? "" : result.error.message, /cannot write run/);
  assert.deepEqual(events, []);
});

test("staging, commit, push, and PR failures skip cleanup", async () => {
  const cases: Array<{
    name: string;
    expectedStage: "staging" | "commit" | "push" | "pr_creation";
    gitOverrides?: ConstructorParameters<typeof FakeGitClient>[1];
    githubResult?: AutomationResult<PullRequestDetails>;
  }> = [
    {
      name: "stage files",
      expectedStage: "staging",
      gitOverrides: {
        stageFiles: {
          ok: false,
          error: gitError("cannot stage")
        }
      }
    },
    {
      name: "commit",
      expectedStage: "commit",
      gitOverrides: {
        commit: {
          ok: false,
          error: gitError("cannot commit")
        }
      }
    },
    {
      name: "push",
      expectedStage: "push",
      gitOverrides: {
        pushBranch: {
          ok: false,
          error: gitError("cannot push")
        }
      }
    },
    {
      name: "pull request",
      expectedStage: "pr_creation",
      githubResult: {
        ok: false,
        error: githubError("cannot create PR")
      }
    }
  ];

  for (const publishCase of cases) {
    await withReleaseArtifacts(async (_root, releasePath, runPath) => {
      const events: string[] = [];
      const gitClient = new FakeGitClient(events, publishCase.gitOverrides);
      const githubClient = new FakeGitHubClient(
        events,
        publishCase.githubResult
      );

      const result = await runReleasePublishWorkflow(
        { ...options, releasePath, runPath },
        {
          gitClient,
          githubClient,
          updateRunStatus: async (input) => {
            events.push(`updateRunStatus:${input.status}`);
            return updateRunStatus(input);
          }
        }
      );

      assert.equal(result.ok, false, publishCase.name);
      assert.equal(
        result.ok || result.error.stage,
        publishCase.expectedStage,
        publishCase.name
      );
      assert.deepEqual(gitClient.cleanupWorktreeInputs, [], publishCase.name);

      const persistedRun = JSON.parse(await readFile(runPath, "utf8")) as Record<
        string,
        unknown
      >;
      assert.equal(persistedRun.status, "publishing", publishCase.name);
      assert.equal(persistedRun.pullRequestURL, undefined, publishCase.name);
    });
  }
});

test("cleanup failure returns after the run artifact is marked published", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];
    const gitClient = new FakeGitClient(events, {
      cleanupWorktree: {
        ok: false,
        error: gitError("worktree still dirty")
      }
    });

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath },
      {
        gitClient,
        githubClient: new FakeGitHubClient(events),
        updateRunStatus: async (input) => {
          events.push(`updateRunStatus:${input.status}`);
          return updateRunStatus(input);
        },
        writePullRequestRunArtifact: async (input) => {
          events.push("writePullRequest");
          return writePullRequestRunArtifact(input);
        }
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok || result.error.stage, "cleanup");
    assert.deepEqual(events, [
      "updateRunStatus:publishing",
      "getChangedFiles",
      "getHead",
      "stageFiles",
      "commit",
      "checkRemoteBranchCommit",
      "pushBranch",
      "listOpenPullRequests",
      "createPullRequest",
      "writePullRequest",
      "updateRunStatus:published",
      "cleanupWorktree"
    ]);

    const persistedRun = JSON.parse(await readFile(runPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(persistedRun.status, "published");
    assert.equal(persistedRun.pullRequestURL, "https://github.com/owner/name/pull/70");
    assert.equal(persistedRun.cleanup, undefined);
  });
});

test("PR URL write failure returns artifact_write before cleanup", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];
    const gitClient = new FakeGitClient(events);

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath },
      {
        gitClient,
        githubClient: new FakeGitHubClient(events),
        updateRunStatus: async (input) => {
          events.push(`updateRunStatus:${input.status}`);
          return updateRunStatus(input);
        },
        writePullRequestRunArtifact: async () => {
          events.push("writePullRequest");
          throw new Error("cannot persist PR URL");
        }
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok || result.error.stage, "artifact_write");
    assert.match(result.ok ? "" : result.error.message, /cannot persist PR URL/);
    assert.deepEqual(events, [
      "updateRunStatus:publishing",
      "getChangedFiles",
      "getHead",
      "stageFiles",
      "commit",
      "checkRemoteBranchCommit",
      "pushBranch",
      "listOpenPullRequests",
      "createPullRequest",
      "writePullRequest"
    ]);
    assert.deepEqual(gitClient.cleanupWorktreeInputs, []);

    const persistedRun = JSON.parse(await readFile(runPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(persistedRun.status, "publishing");
    assert.equal(persistedRun.pullRequestURL, undefined);
  });
});

test("published status write failure returns artifact_write before cleanup", async () => {
  await withReleaseArtifacts(async (_root, releasePath, runPath) => {
    const events: string[] = [];
    const gitClient = new FakeGitClient(events);

    const result = await runReleasePublishWorkflow(
      { ...options, releasePath, runPath },
      {
        gitClient,
        githubClient: new FakeGitHubClient(events),
        updateRunStatus: async (input) => {
          events.push(`updateRunStatus:${input.status}`);
          if (input.status === "published") {
            throw new Error("disk full");
          }
          return updateRunStatus(input);
        },
        writePullRequestRunArtifact: async (input) => {
          events.push("writePullRequest");
          return writePullRequestRunArtifact(input);
        }
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok || result.error.stage, "artifact_write");
    assert.match(result.ok ? "" : result.error.message, /disk full/);
    assert.deepEqual(events, [
      "updateRunStatus:publishing",
      "getChangedFiles",
      "getHead",
      "stageFiles",
      "commit",
      "checkRemoteBranchCommit",
      "pushBranch",
      "listOpenPullRequests",
      "createPullRequest",
      "writePullRequest",
      "updateRunStatus:published"
    ]);
    assert.deepEqual(gitClient.cleanupWorktreeInputs, []);

    const persistedRun = JSON.parse(await readFile(runPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(persistedRun.status, "publishing");
    assert.equal(persistedRun.pullRequestURL, "https://github.com/owner/name/pull/70");
  });
});

async function withReleaseArtifacts(
  callback: (
    root: string,
    releasePath: string,
    runPath: string
  ) => Promise<void>,
  runArtifact: Record<string, unknown> = run
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "release-publish-workflow-"));
  const releasePath = path.join(root, "release.json");
  const runPath = path.join(root, "run.json");
  await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`, "utf8");
  await writeFile(runPath, `${JSON.stringify(runArtifact, null, 2)}\n`, "utf8");

  try {
    await callback(root, releasePath, runPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withRawRunArtifact(
  runContents: string,
  callback: (releasePath: string, runPath: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "release-publish-workflow-"));
  const releasePath = path.join(root, "release.json");
  const runPath = path.join(root, "run.json");
  await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`, "utf8");
  await writeFile(runPath, runContents, "utf8");

  try {
    await callback(releasePath, runPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function gitError(message: string): GitAutomationError {
  return {
    code: "unknown",
    message
  };
}

function githubError(message: string): GitHubAutomationError {
  return {
    code: "unknown",
    message
  };
}
