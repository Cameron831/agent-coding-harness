import assert from "node:assert/strict";
import test from "node:test";
import {
  runPrepareWorkflow,
  type AutomationResult,
  type CloseIssueInput,
  type CreateIssueInput,
  type CreatePullRequestInput,
  type GitHubAutomationClient,
  type IssueDetails,
  type IssueIdentifier,
  type PrepareArtifactWriterInput,
  type PrepareArtifactWriterResult,
  type PrepareIssueWorkspaceDependencies,
  type PrepareIssueWorkspaceInput,
  type PrepareIssueWorkspaceResult,
  type PullRequestDetails,
  type RenderPreparePromptInput
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

  constructor(private readonly getIssueResult: AutomationResult<IssueDetails>) {}

  async createIssue(
    _input: CreateIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("createIssue should not be called by prepare workflow tests.");
  }

  async getIssue(
    input: IssueIdentifier
  ): Promise<AutomationResult<IssueDetails>> {
    this.getIssueInputs.push(input);
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

test("prepare workflow fetches the issue before workspace prep, prompt rendering, and artifact writing", async () => {
  const events: string[] = [];
  const client = new FakeGitHubClient({
    ok: true,
    value: fetchedIssue
  });
  const prepareWorkspaceInputs: PrepareIssueWorkspaceInput[] = [];
  const renderPromptInputs: RenderPreparePromptInput[] = [];
  const writeArtifactInputs: PrepareArtifactWriterInput[] = [];
  const gitClient = {};

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
      gitClient: gitClient as never,
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
      writeArtifacts: async (input) => {
        events.push("artifacts");
        writeArtifactInputs.push(input);
        return artifactResult();
      }
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(client.getIssueInputs, [
    {
      repository,
      issueNumber: 47
    }
  ]);
  assert.deepEqual(events, ["workspace", "prompt", "artifacts"]);
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
  assert.deepEqual(writeArtifactInputs, [
    {
      issue: fetchedIssue,
      prompt: "rendered prompt",
      branchName: "47-add-prepare-workflow",
      worktreePath: "C:/repos/worktrees/issue-47",
      runsDirectory: "custom-runs"
    }
  ]);
});

test("prepare workflow success exposes artifact paths, branch, and worktree path", async () => {
  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    prepareWorkspace: async () => ({
      ok: true,
      value: {
        branchName: "47-add-prepare-workflow",
        targetWorktreePath: "C:/repos/worktrees/issue-47"
      }
    }),
    renderPrompt: async () => "prompt",
    writeArtifacts: async () => artifactResult()
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
    prepareWorkspace: async () => ({
      ok: true,
      value: {
        branchName: "47-add-prepare-workflow",
        targetWorktreePath: "C:/repos/worktrees/issue-47"
      }
    }),
    renderPrompt: async () => "prompt",
    writeArtifacts: async () => artifactResult()
  });

  assert.equal(result.ok, true);
  assert.equal(factoryCalls, 1);
  assert.equal(client.getIssueInputs.length, 1);
});

test("prepare workflow stops when issue fetch fails", async () => {
  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({
      ok: false,
      error: {
        code: "not_found",
        message: "issue not found"
      }
    }),
    prepareWorkspace: async () => {
      throw new Error("workspace prep should not be called.");
    },
    renderPrompt: async () => {
      throw new Error("prompt rendering should not be called.");
    },
    writeArtifacts: async () => {
      throw new Error("artifact writing should not be called.");
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
});

test("prepare workflow stops when workspace prep fails", async () => {
  let promptRendered = false;
  let artifactsWritten = false;

  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    prepareWorkspace: async (): Promise<PrepareIssueWorkspaceResult> => ({
      ok: false,
      error: {
        code: "unknown",
        message: "branch already exists"
      }
    }),
    renderPrompt: async () => {
      promptRendered = true;
      return "prompt";
    },
    writeArtifacts: async () => {
      artifactsWritten = true;
      return artifactResult();
    }
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      stage: "workspace_prep",
      code: "unknown",
      message: "branch already exists"
    }
  });
  assert.equal(promptRendered, false);
  assert.equal(artifactsWritten, false);
});

test("prepare workflow returns prompt rendering failures without writing artifacts", async () => {
  let artifactsWritten = false;

  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    prepareWorkspace: async () => ({
      ok: true,
      value: {
        branchName: "47-add-prepare-workflow",
        targetWorktreePath: "C:/repos/worktrees/issue-47"
      }
    }),
    renderPrompt: async () => {
      throw new Error("template missing");
    },
    writeArtifacts: async () => {
      artifactsWritten = true;
      return artifactResult();
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "prompt_render");
  assert.equal(result.ok || result.error.message, "template missing");
  assert.equal(artifactsWritten, false);
});

test("prepare workflow returns artifact writing failures", async () => {
  const result = await runPrepareWorkflow(options, {
    githubClient: new FakeGitHubClient({ ok: true, value: fetchedIssue }),
    prepareWorkspace: async () => ({
      ok: true,
      value: {
        branchName: "47-add-prepare-workflow",
        targetWorktreePath: "C:/repos/worktrees/issue-47"
      }
    }),
    renderPrompt: async () => "prompt",
    writeArtifacts: async () => {
      throw new Error("disk full");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.equal(result.ok || result.error.message, "disk full");
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
      branch: "47-add-prepare-workflow"
    }
  };
}
