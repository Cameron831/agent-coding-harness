import assert from "node:assert/strict";
import test from "node:test";
import {
  runPrepareWorkflow,
  type AutomationResult,
  type CloseIssueInput,
  type CleanupWorktreeInput,
  type CleanupWorktreeResult,
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
  type GitAutomationResult,
  type GitHubAutomationClient,
  type IssueDetails,
  type IssueIdentifier,
  type PrepareArtifactWriterResult,
  type PrepareIssueWorkspaceDependencies,
  type PrepareIssueWorkspaceInput,
  type PrepareIssueWorkspaceResult,
  type PushBranchInput,
  type PushBranchResult,
  type PullRequestDetails,
  type RenderImplementPromptInput,
  type StageFilesInput,
  type StageFilesResult,
  type UpdatePrepareRunArtifactInput as UpdateRunArtifactInput,
  type UpdatePrepareRunArtifactResult as UpdateRunArtifactResult,
  type WriteIssueArtifactInput,
  type WriteIssueArtifactResult,
  type WritePromptArtifactInput,
  type WritePromptArtifactResult,
  type WriteRunArtifactInput,
  type WriteRunArtifactResult,
  type WorktreeDetails
} from "../src/index.js";

const repository = { owner: "owner", name: "name" };
const fetchedIssue: IssueDetails = {
  repository,
  issueNumber: 47,
  title: "Add prepare workflow",
  body: "Compose prepare helpers.",
  state: "open",
  url: "https://github.com/owner/name/issues/47"
};

const options = {
  repository,
  issueNumber: 47,
  targetRepositoryPath: "C:/repos/target",
  worktreeParentPath: "C:/repos/worktrees"
};

class FakeGitHubClient implements GitHubAutomationClient {
  readonly getIssueInputs: IssueIdentifier[] = [];

  constructor(
    private readonly getIssueResult: AutomationResult<IssueDetails>,
    private readonly onGetIssue?: () => void
  ) {}

  async createIssue(
    _input: CreateIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("createIssue should not be called by prepare workflow tests.");
  }

  async getIssue(
    input: IssueIdentifier
  ): Promise<AutomationResult<IssueDetails>> {
    this.getIssueInputs.push(input);
    this.onGetIssue?.();
    return this.getIssueResult;
  }

  async closeIssue(
    _input: CloseIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("closeIssue should not be called by prepare workflow tests.");
  }

  async createPullRequest(
    _input: CreatePullRequestInput
  ): Promise<AutomationResult<PullRequestDetails>> {
    throw new Error(
      "createPullRequest should not be called by prepare workflow tests."
    );
  }
}

class FakeGitClient implements GitAutomationClient {
  readonly getHeadInputs: GetHeadInput[] = [];

  constructor(
    private readonly getHeadResult: GitAutomationResult<GetHeadResult> = {
      ok: true,
      value: {
        targetWorktreePath: "C:/repos/worktrees/issue-47",
        head: "abc123before"
      }
    },
    private readonly onGetHead?: () => void
  ) {}

  async createWorktree(
    _input: CreateWorktreeInput
  ): Promise<GitAutomationResult<WorktreeDetails>> {
    throw new Error("createWorktree should not be called by prepare workflow tests.");
  }

  async stageFiles(
    _input: StageFilesInput
  ): Promise<GitAutomationResult<StageFilesResult>> {
    throw new Error("stageFiles should not be called by prepare workflow tests.");
  }

  async getDiff(_input: GetDiffInput): Promise<GitAutomationResult<GetDiffResult>> {
    throw new Error("getDiff should not be called by prepare workflow tests.");
  }

  async getHead(input: GetHeadInput): Promise<GitAutomationResult<GetHeadResult>> {
    this.getHeadInputs.push(input);
    this.onGetHead?.();
    return this.getHeadResult;
  }

  async getChangedFiles(
    _input: GetChangedFilesInput
  ): Promise<GitAutomationResult<GetChangedFilesResult>> {
    throw new Error("getChangedFiles should not be called by prepare workflow tests.");
  }

  async commit(_input: CommitInput): Promise<GitAutomationResult<CommitResult>> {
    throw new Error("commit should not be called by prepare workflow tests.");
  }

  async pushBranch(
    _input: PushBranchInput
  ): Promise<GitAutomationResult<PushBranchResult>> {
    throw new Error("pushBranch should not be called by prepare workflow tests.");
  }

  async cleanupWorktree(
    _input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>> {
    throw new Error("cleanupWorktree should not be called by prepare workflow tests.");
  }
}

test("prepare workflow writes prepare artifacts incrementally as data becomes available", async () => {
  const events: string[] = [];
  const client = new FakeGitHubClient({
    ok: true,
    value: fetchedIssue
  }, () => events.push("issue"));
  const prepareWorkspaceInputs: PrepareIssueWorkspaceInput[] = [];
  const renderPromptInputs: RenderImplementPromptInput[] = [];
  const writeRunInputs: WriteRunArtifactInput[] = [];
  const writeIssueInputs: WriteIssueArtifactInput[] = [];
  const writePromptInputs: WritePromptArtifactInput[] = [];
  const updateRunInputs: UpdateRunArtifactInput[] = [];
  const gitClient = new FakeGitClient(undefined, () => events.push("head"));

  const result = await runPrepareWorkflow(
    {
      ...options,
      settings: {
        baseRef: "origin/main",
        promptVariant: "with-subagents",
        promptsDirectory: "custom-prompts",
        runsDirectory: "custom-runs"
      }
    },
    {
      githubClient: client,
      gitClient,
      prepareWorkspace: async (
        input,
        dependencies?: PrepareIssueWorkspaceDependencies
      ) => {
        events.push("workspace");
        assert.equal(dependencies?.gitClient, gitClient);
        prepareWorkspaceInputs.push(input);
        return {
          ok: true,
          value: {
            branchName: "47-add-prepare-workflow",
            targetWorktreePath: "C:/repos/worktrees/issue-47"
          }
        };
      },
      renderPrompt: async (input) => {
        events.push("prompt");
        renderPromptInputs.push(input);
        return "rendered prompt";
      },
      writeRunArtifact: async (input) => {
        events.push("run:start");
        writeRunInputs.push(input);
        return runArtifactResult({ status: "preparing" });
      },
      writeIssueArtifact: async (input) => {
        events.push("issue-artifact");
        writeIssueInputs.push(input);
        return issueArtifactResult();
      },
      writePromptArtifact: async (input) => {
        events.push("prompt-artifact");
        writePromptInputs.push(input);
        return promptArtifactResult();
      },
      updateRunArtifact: async (input) => {
        updateRunInputs.push(input);
        if (input.issue !== undefined) {
          events.push("run:issue");
        } else if (input.worktreePath !== undefined) {
          events.push("run:workspace");
        } else if (
          input.beforeHead !== undefined &&
          input.status === "prepared"
        ) {
          events.push("run:head-prepared");
        } else if (input.status === "prepared") {
          events.push("run:prepared");
        }
        return runArtifactResult(
          input.status === "prepared" ? artifactResult().run : { status: "preparing" }
        );
      }
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(gitClient.getHeadInputs, [
    {
      targetWorktreePath: "C:/repos/worktrees/issue-47"
    }
  ]);
  assert.deepEqual(client.getIssueInputs, [
    {
      repository,
      issueNumber: 47
    }
  ]);
  assert.deepEqual(events, [
    "run:start",
    "issue",
    "issue-artifact",
    "run:issue",
    "prompt",
    "prompt-artifact",
    "workspace",
    "run:workspace",
    "head",
    "run:head-prepared"
  ]);
  assert.deepEqual(writeRunInputs, [
    {
      issueNumber: 47,
      runsDirectory: "custom-runs"
    }
  ]);
  assert.deepEqual(writeIssueInputs, [
    {
      issue: fetchedIssue,
      runsDirectory: "custom-runs"
    }
  ]);
  assert.deepEqual(prepareWorkspaceInputs, [
    {
      issueNumber: fetchedIssue.issueNumber,
      issueTitle: fetchedIssue.title,
      targetRepositoryPath: options.targetRepositoryPath,
      worktreeParentPath: options.worktreeParentPath,
      baseRef: "origin/main"
    }
  ]);
  assert.deepEqual(renderPromptInputs, [
    {
      issue: fetchedIssue,
      variant: "with-subagents",
      promptsDirectory: "custom-prompts"
    }
  ]);
  assert.deepEqual(writePromptInputs, [
    {
      issueNumber: 47,
      prompt: "rendered prompt",
      runsDirectory: "custom-runs"
    }
  ]);
  assert.deepEqual(updateRunInputs, [
    {
      issueNumber: 47,
      issue: fetchedIssue,
      runsDirectory: "custom-runs"
    },
    {
      issueNumber: 47,
      worktreePath: "C:/repos/worktrees/issue-47",
      branchName: "47-add-prepare-workflow",
      runsDirectory: "custom-runs"
    },
    {
      issueNumber: 47,
      beforeHead: "abc123before",
      status: "prepared",
      runsDirectory: "custom-runs"
    }
  ]);
});

test("prepare workflow success exposes artifact paths, branch, and worktree path", async () => {
  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    gitClient: new FakeGitClient(),
    prepareWorkspace: async () => ({
      ok: true,
      value: {
        branchName: "47-add-prepare-workflow",
        targetWorktreePath: "C:/repos/worktrees/issue-47"
      }
    }),
    renderPrompt: async () => "prompt",
    writeRunArtifact: async () => runArtifactResult({ status: "preparing" }),
    writeIssueArtifact: async () => issueArtifactResult(),
    writePromptArtifact: async () => promptArtifactResult(),
    updateRunArtifact: async (input) =>
      runArtifactResult(
        input.status === "prepared" ? artifactResult().run : { status: "preparing" }
      )
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      issue: fetchedIssue,
      promptPath: ".runs/issue-47/prompt.md",
      issuePath: ".runs/issue-47/issue.json",
      runPath: ".runs/issue-47/run.json",
      branchName: "47-add-prepare-workflow",
      branch: "47-add-prepare-workflow",
      worktreePath: "C:/repos/worktrees/issue-47",
      artifacts: artifactResult()
    }
  });
});

test("prepare workflow can create the GitHub client through dependency injection", async () => {
  const client = new FakeGitHubClient({ ok: true, value: fetchedIssue });
  let factoryCalls = 0;

  const result = await runPrepareWorkflow(options, {
    createGitHubClient: () => {
      factoryCalls += 1;
      return client;
    },
    gitClient: new FakeGitClient(),
    prepareWorkspace: async () => ({
      ok: true,
      value: {
        branchName: "47-add-prepare-workflow",
        targetWorktreePath: "C:/repos/worktrees/issue-47"
      }
    }),
    renderPrompt: async () => "prompt",
    writeRunArtifact: async () => runArtifactResult({ status: "preparing" }),
    writeIssueArtifact: async () => issueArtifactResult(),
    writePromptArtifact: async () => promptArtifactResult(),
    updateRunArtifact: async (input) =>
      runArtifactResult(
        input.status === "prepared" ? artifactResult().run : { status: "preparing" }
      )
  });

  assert.equal(result.ok, true);
  assert.equal(factoryCalls, 1);
  assert.equal(client.getIssueInputs.length, 1);
});

test("prepare workflow stops when issue fetch fails after the initial run artifact", async () => {
  let initialRunWritten = false;
  let issueArtifactWritten = false;

  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({
      ok: false,
      error: {
        code: "not_found",
        message: "issue not found"
      }
    }),
    writeRunArtifact: async () => {
      initialRunWritten = true;
      return runArtifactResult({ status: "preparing" });
    },
    writeIssueArtifact: async () => {
      issueArtifactWritten = true;
      return issueArtifactResult();
    },
    prepareWorkspace: async () => {
      throw new Error("workspace prep should not be called.");
    },
    renderPrompt: async () => {
      throw new Error("prompt rendering should not be called.");
    }
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      stage: "issue_fetch",
      code: "not_found",
      message: "issue not found"
    }
  });
  assert.equal(initialRunWritten, true);
  assert.equal(issueArtifactWritten, false);
});

test("prepare workflow stops when workspace prep fails without workspace or head run fields", async () => {
  let promptRendered = false;
  let promptWritten = false;
  const updateRunInputs: UpdateRunArtifactInput[] = [];

  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    gitClient: new FakeGitClient(),
    writeRunArtifact: async () => runArtifactResult({ status: "preparing" }),
    writeIssueArtifact: async () => issueArtifactResult(),
    updateRunArtifact: async (input) => {
      updateRunInputs.push(input);
      return runArtifactResult({ status: "preparing" });
    },
    renderPrompt: async () => {
      promptRendered = true;
      return "prompt";
    },
    writePromptArtifact: async () => {
      promptWritten = true;
      return promptArtifactResult();
    },
    prepareWorkspace: async (): Promise<PrepareIssueWorkspaceResult> => ({
      ok: false,
      error: {
        code: "unknown",
        message: "branch already exists"
      }
    })
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      stage: "workspace_prep",
      code: "unknown",
      message: "branch already exists"
    }
  });
  assert.equal(promptRendered, true);
  assert.equal(promptWritten, true);
  assert.deepEqual(updateRunInputs, [
    {
      issueNumber: 47,
      issue: fetchedIssue
    }
  ]);
});

test("prepare workflow returns prompt rendering failures without writing prompt artifact", async () => {
  let promptWritten = false;
  let workspacePrepared = false;

  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    gitClient: new FakeGitClient(),
    writeRunArtifact: async () => runArtifactResult({ status: "preparing" }),
    writeIssueArtifact: async () => issueArtifactResult(),
    updateRunArtifact: async () => runArtifactResult({ status: "preparing" }),
    prepareWorkspace: async () => {
      workspacePrepared = true;
      return {
        ok: true,
        value: {
          branchName: "47-add-prepare-workflow",
          targetWorktreePath: "C:/repos/worktrees/issue-47"
        }
      };
    },
    renderPrompt: async () => {
      throw new Error("template missing");
    },
    writePromptArtifact: async () => {
      promptWritten = true;
      return promptArtifactResult();
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "prompt_render");
  assert.equal(result.ok || result.error.message, "template missing");
  assert.equal(promptWritten, false);
  assert.equal(workspacePrepared, false);
});

test("prepare workflow returns artifact writing failures", async () => {
  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    gitClient: new FakeGitClient(),
    prepareWorkspace: async () => ({
      ok: true,
      value: {
        branchName: "47-add-prepare-workflow",
        targetWorktreePath: "C:/repos/worktrees/issue-47"
      }
    }),
    renderPrompt: async () => "prompt",
    writeRunArtifact: async () => {
      throw new Error("disk full");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.equal(result.ok || result.error.message, "disk full");
});

test("prepare workflow returns getHead failures without beforeHead or prepared run updates", async () => {
  let promptRendered = false;
  let promptWritten = false;
  const updateRunInputs: UpdateRunArtifactInput[] = [];
  const gitClient = new FakeGitClient({
    ok: false,
    error: {
      code: "unknown",
      message: "cannot read head"
    }
  });

  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    gitClient,
    writeRunArtifact: async () => runArtifactResult({ status: "preparing" }),
    writeIssueArtifact: async () => issueArtifactResult(),
    writePromptArtifact: async () => {
      promptWritten = true;
      return promptArtifactResult();
    },
    updateRunArtifact: async (input) => {
      updateRunInputs.push(input);
      return runArtifactResult({ status: "preparing" });
    },
    prepareWorkspace: async () => ({
      ok: true,
      value: {
        branchName: "47-add-prepare-workflow",
        targetWorktreePath: "C:/repos/worktrees/issue-47"
      }
    }),
    renderPrompt: async () => {
      promptRendered = true;
      return "prompt";
    }
  });

  assert.deepEqual(gitClient.getHeadInputs, [
    {
      targetWorktreePath: "C:/repos/worktrees/issue-47"
    }
  ]);
  assert.deepEqual(result, {
    ok: false,
    error: {
      stage: "workspace_prep",
      code: "unknown",
      message: "cannot read head"
    }
  });
  assert.equal(promptRendered, true);
  assert.equal(promptWritten, true);
  assert.deepEqual(updateRunInputs, [
    {
      issueNumber: 47,
      issue: fetchedIssue
    },
    {
      issueNumber: 47,
      worktreePath: "C:/repos/worktrees/issue-47",
      branchName: "47-add-prepare-workflow"
    }
  ]);
});

test("prepare workflow returns thrown getHead errors at workspace prep", async () => {
  const gitClient = new FakeGitClient();
  gitClient.getHead = async () => {
    throw new Error("head unavailable");
  };

  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    gitClient,
    prepareWorkspace: async () => ({
      ok: true,
      value: {
        branchName: "47-add-prepare-workflow",
        targetWorktreePath: "C:/repos/worktrees/issue-47"
      }
    }),
    renderPrompt: async () => "prompt",
    writeRunArtifact: async () => runArtifactResult({ status: "preparing" }),
    writeIssueArtifact: async () => issueArtifactResult(),
    writePromptArtifact: async () => promptArtifactResult(),
    updateRunArtifact: async () => runArtifactResult({ status: "preparing" })
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "workspace_prep");
  assert.equal(result.ok || result.error.message, "head unavailable");
});

function artifactResult(): PrepareArtifactWriterResult {
  return {
    runDirectory: ".runs/issue-47",
    promptPath: ".runs/issue-47/prompt.md",
    issuePath: ".runs/issue-47/issue.json",
    runPath: ".runs/issue-47/run.json",
    issue: {
      number: 47,
      title: "Add prepare workflow",
      body: "Compose prepare helpers."
    },
    run: {
      status: "prepared",
      issueURL: "https://github.com/owner/name/issues/47",
      issueTitle: "Add prepare workflow",
      issueNumber: 47,
      worktreePath: "C:/repos/worktrees/issue-47",
      branch: "47-add-prepare-workflow",
      beforeHead: "abc123before"
    }
  };
}

function issueArtifactResult(): WriteIssueArtifactResult {
  const artifacts = artifactResult();

  return {
    runDirectory: artifacts.runDirectory,
    issuePath: artifacts.issuePath,
    issue: artifacts.issue
  };
}

function promptArtifactResult(): WritePromptArtifactResult {
  const artifacts = artifactResult();

  return {
    runDirectory: artifacts.runDirectory,
    promptPath: artifacts.promptPath
  };
}

function runArtifactResult(
  run: WriteRunArtifactResult["run"]
): UpdateRunArtifactResult {
  const artifacts = artifactResult();

  return {
    runDirectory: artifacts.runDirectory,
    runPath: artifacts.runPath,
    run
  };
}
