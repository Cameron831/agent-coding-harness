import assert from "node:assert/strict";
import test from "node:test";
import {
  runImplementIssueWorkflow,
  type CleanupWorktreeInput,
  type CleanupWorktreeResult,
  type CommitInput,
  type CommitResult,
  type CreateWorktreeInput,
  type GetChangedFilesInput,
  type GetChangedFilesResult,
  type GetDiffInput,
  type GetDiffResult,
  type GetHeadInput,
  type GetHeadResult,
  type GitAutomationClient,
  type GitAutomationResult,
  type ImplementArtifactWriterInput,
  type ImplementArtifactWriterResult,
  type ImplementVerificationInput,
  type ImplementVerificationResult,
  type ImplementWorkflowOptions,
  type ImplementWorkflowResult,
  type ImplementorReleaseMetadata,
  type PushBranchInput,
  type PushBranchResult,
  type StageFilesInput,
  type StageFilesResult,
  type WorktreeDetails
} from "../src/index.js";

const release: ImplementorReleaseMetadata = {
  commit_message: "Add implement workflow orchestration",
  pull_request: {
    title: "Add implement workflow orchestration",
    summary: "Runs implementation, verification, diff capture, and artifact writing.",
    scope: ["Added implement orchestration workflow."],
    verification: ["npm test"]
  }
};

const options = {
  promptPath: ".runs/issue-65/prompt.md",
  targetWorktreePath: "C:/repos/worktrees/issue-65",
  issueNumber: 65,
  beforeHead: "abc123before"
};

class FakeGitClient implements GitAutomationClient {
  readonly getDiffInputs: GetDiffInput[] = [];

  constructor(
    private readonly result: GitAutomationResult<GetDiffResult>,
    private readonly onGetDiff?: () => void
  ) {}

  async getDiff(input: GetDiffInput): Promise<GitAutomationResult<GetDiffResult>> {
    this.getDiffInputs.push(input);
    this.onGetDiff?.();
    return this.result;
  }

  async createWorktree(
    _input: CreateWorktreeInput
  ): Promise<GitAutomationResult<WorktreeDetails>> {
    throw new Error("createWorktree should not be called.");
  }

  async stageFiles(
    _input: StageFilesInput
  ): Promise<GitAutomationResult<StageFilesResult>> {
    throw new Error("stageFiles should not be called.");
  }

  async getHead(_input: GetHeadInput): Promise<GitAutomationResult<GetHeadResult>> {
    throw new Error("getHead should not be called.");
  }

  async getChangedFiles(
    _input: GetChangedFilesInput
  ): Promise<GitAutomationResult<GetChangedFilesResult>> {
    throw new Error("getChangedFiles should not be called.");
  }

  async commit(_input: CommitInput): Promise<GitAutomationResult<CommitResult>> {
    throw new Error("commit should not be called.");
  }

  async pushBranch(
    _input: PushBranchInput
  ): Promise<GitAutomationResult<PushBranchResult>> {
    throw new Error("pushBranch should not be called.");
  }

  async cleanupWorktree(
    _input: CleanupWorktreeInput
  ): Promise<GitAutomationResult<CleanupWorktreeResult>> {
    throw new Error("cleanupWorktree should not be called.");
  }
}

test("implement issue workflow sequences agent, verification, diff, and artifact writing", async () => {
  const events: string[] = [];
  const agentInputs: ImplementWorkflowOptions[] = [];
  const verificationInputs: ImplementVerificationInput[] = [];
  const artifactInputs: ImplementArtifactWriterInput[] = [];
  const gitClient = new FakeGitClient(diffResult(), () => events.push("diff"));

  const result = await runImplementIssueWorkflow(
    {
      ...options,
      settings: {
        runsDirectory: "custom-runs",
        testCommand: "npm run test -- --test-name-pattern implement"
      }
    },
    {
      agentWorkflow: async (input) => {
        events.push("agent");
        agentInputs.push(input);
        return agentResult();
      },
      verificationRunner: async (input) => {
        events.push("verification");
        verificationInputs.push(input);
        return verificationResult({ status: "passed" });
      },
      gitClient,
      writeArtifacts: async (input) => {
        events.push("artifacts");
        artifactInputs.push(input);
        return artifactResult();
      }
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(events, ["agent", "verification", "diff", "artifacts"]);
  assert.deepEqual(agentInputs, [
    {
      promptPath: options.promptPath,
      targetWorktreePath: options.targetWorktreePath
    }
  ]);
  assert.deepEqual(verificationInputs, [
    {
      issueNumber: options.issueNumber,
      targetWorktreePath: options.targetWorktreePath,
      beforeHead: options.beforeHead,
      testCommand: "npm run test -- --test-name-pattern implement"
    }
  ]);
  assert.deepEqual(gitClient.getDiffInputs, [
    {
      targetWorktreePath: options.targetWorktreePath
    }
  ]);
  assert.deepEqual(artifactInputs, [
    {
      issueNumber: options.issueNumber,
      diff: "diff --git a/file.ts b/file.ts\n",
      verificationOutput: "rendered verification report",
      release,
      runsDirectory: "custom-runs"
    }
  ]);
});

test("implement issue workflow exposes release, verification, diff, and artifact outputs", async () => {
  const verification = verificationResult({ status: "passed" });
  const diff = diffResult().value;
  const artifacts = artifactResult();

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => verification,
    gitClient: new FakeGitClient({ ok: true, value: diff }),
    writeArtifacts: async () => artifacts
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      release,
      verification,
      diff,
      artifacts
    }
  });
});

test("implement issue workflow writes artifacts when verification status is failed", async () => {
  let artifactsWritten = false;

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => verificationResult({ status: "failed" }),
    gitClient: new FakeGitClient(diffResult()),
    writeArtifacts: async () => {
      artifactsWritten = true;
      return artifactResult();
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.verification.status, "failed");
  assert.equal(artifactsWritten, true);
});

test("implement issue workflow stops when agent orchestration fails", async () => {
  let verificationCalled = false;
  let diffCalled = false;
  let artifactsWritten = false;

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => ({
      ok: false,
      error: {
        stage: "sdk_execution",
        message: "codex failed"
      }
    }),
    verificationRunner: async () => {
      verificationCalled = true;
      return verificationResult({ status: "passed" });
    },
    gitClient: new FakeGitClient(diffResult(), () => {
      diffCalled = true;
    }),
    writeArtifacts: async () => {
      artifactsWritten = true;
      return artifactResult();
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "agent_orchestration");
  assert.equal(result.ok || result.error.message, "codex failed");
  assert.equal(verificationCalled, false);
  assert.equal(diffCalled, false);
  assert.equal(artifactsWritten, false);
});

test("implement issue workflow stops without artifact writing when diff retrieval fails", async () => {
  let artifactsWritten = false;

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => verificationResult({ status: "passed" }),
    gitClient: new FakeGitClient({
      ok: false,
      error: {
        code: "unknown",
        message: "git diff failed"
      }
    }),
    writeArtifacts: async () => {
      artifactsWritten = true;
      return artifactResult();
    }
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      stage: "diff",
      code: "unknown",
      message: "git diff failed"
    }
  });
  assert.equal(artifactsWritten, false);
});

test("implement issue workflow returns artifact write failures with the underlying message", async () => {
  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => verificationResult({ status: "passed" }),
    gitClient: new FakeGitClient(diffResult()),
    writeArtifacts: async () => {
      throw new Error("disk full");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.equal(result.ok || result.error.message, "disk full");
});

function agentResult(): ImplementWorkflowResult {
  return {
    ok: true,
    value: {
      release
    }
  };
}

function diffResult(): { ok: true; value: GetDiffResult } {
  return {
    ok: true,
    value: {
      targetWorktreePath: options.targetWorktreePath,
      diff: "diff --git a/file.ts b/file.ts\n"
    }
  };
}

function verificationResult(input: {
  status: "passed" | "failed";
}): ImplementVerificationResult {
  return {
    issueNumber: options.issueNumber,
    targetWorktreePath: options.targetWorktreePath,
    status: input.status,
    startedAt: "2026-05-08T20:00:00.000Z",
    finishedAt: "2026-05-08T20:00:03.000Z",
    beforeHead: options.beforeHead,
    afterHead: options.beforeHead,
    changedFiles: ["src/workflow/implement/implement.ts"],
    checks: [
      {
        name: "Test suite",
        status: input.status,
        passed: input.status === "passed",
        details: `Status: ${input.status}`
      }
    ],
    testCommand: {
      command: "npm test",
      exitCode: input.status === "passed" ? 0 : 1,
      output: input.status
    },
    report: "rendered verification report"
  };
}

function artifactResult(): ImplementArtifactWriterResult {
  return {
    runDirectory: ".runs/issue-65",
    diffPath: ".runs/issue-65/diff.patch",
    verificationOutputPath: ".runs/issue-65/verification.txt",
    releasePath: ".runs/issue-65/release.json",
    runPath: ".runs/issue-65/run.json",
    release,
    run: {
      status: "needsFeedback"
    }
  };
}
