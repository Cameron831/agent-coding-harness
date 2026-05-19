import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runImplementIssueWorkflow,
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
  type ImplementArtifactWriterResult,
  type ImplementIssueWorkflowDependencies,
  type ImplementVerificationInput,
  type ImplementVerificationResult,
  type ImplementWorkflowOptions,
  type ImplementWorkflowResult,
  type ImplementorReleaseMetadata,
  type PushBranchInput,
  type PushBranchResult,
  type StageFilesInput,
  type StageFilesResult,
  type WorktreeDetails,
  type UpdateImplementRunArtifactInput as UpdateRunArtifactInput,
  type UpdateImplementRunArtifactResult as UpdateRunArtifactResult,
  type WriteDiffArtifactInput,
  type WriteDiffArtifactResult,
  type WriteReleaseArtifactInput,
  type WriteReleaseArtifactResult,
  type WriteVerificationArtifactInput,
  type WriteVerificationArtifactResult
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

const retryRelease: ImplementorReleaseMetadata = {
  commit_message: "Retry implement workflow orchestration",
  pull_request: {
    title: "Retry implement workflow orchestration",
    summary: "Applies verification feedback from an automatic retry.",
    scope: ["Updated implement orchestration retry behavior."],
    verification: ["npm test -- --test-name-pattern implement"]
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

  async fetchRemoteTrackingRef(
    _input: FetchRemoteTrackingRefInput
  ): Promise<GitAutomationResult<FetchRemoteTrackingRefResult>> {
    throw new Error("fetchRemoteTrackingRef should not be called.");
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

  async checkRemoteBranchCommit(): Promise<never> {
    throw new Error("checkRemoteBranchCommit should not be called.");
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

  async deleteLocalBranch(
    _input: DeleteLocalBranchInput
  ): Promise<GitAutomationResult<DeleteLocalBranchResult>> {
    throw new Error("deleteLocalBranch should not be called.");
  }
}

test("implement issue workflow sequences individual artifact writes", async () => {
  const events: string[] = [];
  const agentInputs: ImplementWorkflowOptions[] = [];
  const verificationInputs: ImplementVerificationInput[] = [];
  const runInputs: UpdateRunArtifactInput[] = [];
  const releaseInputs: WriteReleaseArtifactInput[] = [];
  const verificationArtifactInputs: WriteVerificationArtifactInput[] = [];
  const diffArtifactInputs: WriteDiffArtifactInput[] = [];
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
      updateRunArtifact: async (input) => {
        events.push(`run:${input.status}`);
        runInputs.push(input);
        return runArtifactResult(input);
      },
      writeReleaseArtifact: async (input) => {
        events.push("release");
        releaseInputs.push(input);
        return releaseArtifactResult(input);
      },
      writeVerificationArtifact: async (input) => {
        events.push("verificationArtifact");
        verificationArtifactInputs.push(input);
        return verificationArtifactResult(input);
      },
      writeDiffArtifact: async (input) => {
        events.push("diffArtifact");
        diffArtifactInputs.push(input);
        return diffArtifactResult(input);
      }
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(events, [
    "run:implementing",
    "agent",
    "release",
    "verification",
    "verificationArtifact",
    "diff",
    "diffArtifact",
    "run:needsFeedback"
  ]);
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
  assert.deepEqual(runInputs, [
    {
      issueNumber: options.issueNumber,
      runsDirectory: "custom-runs",
      status: "implementing"
    },
    {
      issueNumber: options.issueNumber,
      runsDirectory: "custom-runs",
      status: "needsFeedback"
    }
  ]);
  assert.deepEqual(releaseInputs, [
    {
      issueNumber: options.issueNumber,
      runsDirectory: "custom-runs",
      release
    }
  ]);
  assert.deepEqual(verificationArtifactInputs, [
    {
      issueNumber: options.issueNumber,
      runsDirectory: "custom-runs",
      verificationOutput: "rendered verification report"
    }
  ]);
  assert.deepEqual(diffArtifactInputs, [
    {
      issueNumber: options.issueNumber,
      runsDirectory: "custom-runs",
      diff: "diff --git a/file.ts b/file.ts\n"
    }
  ]);
});

test("implement issue workflow exposes release, verification, diff, and artifact outputs", async () => {
  const verification = verificationResult({ status: "passed" });
  const diff = diffResult().value;

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => verification,
    gitClient: new FakeGitClient({ ok: true, value: diff }),
    ...artifactWriters()
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      release,
      verification,
      diff,
      artifacts: artifactResult()
    }
  });
});

test("implement issue workflow passes without retry or feedback prompt", async () => {
  const runsDirectory = await mkdtemp(join(tmpdir(), "implement-pass-"));
  const agentInputs: ImplementWorkflowOptions[] = [];

  const result = await runImplementIssueWorkflow(
    {
      ...options,
      runsDirectory
    },
    {
      agentWorkflow: async (input) => {
        agentInputs.push(input);
        return agentResult();
      },
      verificationRunner: async () => verificationResult({ status: "passed" }),
      gitClient: new FakeGitClient(diffResult()),
      ...artifactWriters()
    }
  );

  assert.equal(result.ok, true);
  assert.equal(agentInputs.length, 1);
  await assert.rejects(
    readFile(
      join(runsDirectory, `issue-${options.issueNumber}`, "feedback-prompt.md"),
      "utf8"
    ),
    /ENOENT/
  );
});

test("implement issue workflow retries once when first verification fails then passes", async () => {
  const runsDirectory = await createIssueArtifactRunDirectory();
  const feedbackPromptPath = join(
    runsDirectory,
    `issue-${options.issueNumber}`,
    "feedback-prompt.md"
  );
  await writeFile(feedbackPromptPath, "stale automatic retry prompt", "utf8");
  const agentInputs: ImplementWorkflowOptions[] = [];
  const releaseInputs: WriteReleaseArtifactInput[] = [];
  const verificationArtifactInputs: WriteVerificationArtifactInput[] = [];
  const verificationResults = [
    verificationResult({
      status: "failed",
      report: "first failed verification report"
    }),
    verificationResult({
      status: "passed",
      report: "retry passed verification report"
    })
  ];

  const result = await runImplementIssueWorkflow(
    {
      ...options,
      runsDirectory
    },
    {
      agentWorkflow: async (input) => {
        agentInputs.push(input);
        return agentInputs.length === 1
          ? agentResult()
          : agentResult(retryRelease);
      },
      verificationRunner: async () => verificationResults.shift()!,
      gitClient: new FakeGitClient(diffResult()),
      ...artifactWriters({
        writeReleaseArtifact: async (input) => {
          releaseInputs.push(input);
          return releaseArtifactResult(input);
        },
        writeVerificationArtifact: async (input) => {
          verificationArtifactInputs.push(input);
          return verificationArtifactResult(input);
        }
      })
    }
  );
  const feedbackPrompt = await readFile(feedbackPromptPath, "utf8");

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value.release, retryRelease);
  assert.deepEqual(result.ok && result.value.artifacts.release, retryRelease);
  assert.equal(result.ok && result.value.verification.status, "passed");
  assert.deepEqual(agentInputs, [
    {
      promptPath: options.promptPath,
      targetWorktreePath: options.targetWorktreePath
    },
    {
      promptPath: feedbackPromptPath,
      targetWorktreePath: options.targetWorktreePath
    }
  ]);
  assert.deepEqual(
    releaseInputs.map((input) => input.release),
    [release, retryRelease]
  );
  assert.deepEqual(
    verificationArtifactInputs.map((input) => input.verificationOutput),
    ["first failed verification report", "retry passed verification report"]
  );
  assert.match(feedbackPrompt, /GitHub issue #65/);
  assert.match(feedbackPrompt, /Local retry issue title/);
  assert.match(feedbackPrompt, /Local retry issue body\./);
  assert.match(feedbackPrompt, /Automatic verification failed/);
  assert.match(feedbackPrompt, /first failed verification report/);
  assert.doesNotMatch(feedbackPrompt, /stale automatic retry prompt/);
  assert.match(
    feedbackPrompt,
    /"commit_message": "Add implement workflow orchestration"/
  );
});

test("implement issue workflow stops after one retry when verification still fails", async () => {
  const runsDirectory = await createIssueArtifactRunDirectory();
  const agentInputs: ImplementWorkflowOptions[] = [];
  const runInputs: UpdateRunArtifactInput[] = [];
  const releaseInputs: WriteReleaseArtifactInput[] = [];
  const verificationArtifactInputs: WriteVerificationArtifactInput[] = [];
  const verificationResults = [
    verificationResult({
      status: "failed",
      report: "first failed verification report"
    }),
    verificationResult({
      status: "failed",
      report: "retry failed verification report"
    })
  ];

  const result = await runImplementIssueWorkflow(
    {
      ...options,
      runsDirectory
    },
    {
      agentWorkflow: async (input) => {
        agentInputs.push(input);
        return agentInputs.length === 1
          ? agentResult()
          : agentResult(retryRelease);
      },
      verificationRunner: async () => verificationResults.shift()!,
      gitClient: new FakeGitClient(diffResult()),
      ...artifactWriters({
        updateRunArtifact: async (input) => {
          runInputs.push(input);
          return runArtifactResult(input);
        },
        writeReleaseArtifact: async (input) => {
          releaseInputs.push(input);
          return releaseArtifactResult(input);
        },
        writeVerificationArtifact: async (input) => {
          verificationArtifactInputs.push(input);
          return verificationArtifactResult(input);
        }
      })
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.verification.status, "failed");
  assert.equal(agentInputs.length, 2);
  assert.deepEqual(
    releaseInputs.map((input) => input.release),
    [release, retryRelease]
  );
  assert.deepEqual(
    verificationArtifactInputs.map((input) => input.verificationOutput),
    ["first failed verification report", "retry failed verification report"]
  );
  assert.deepEqual(result.ok && result.value.release, retryRelease);
  assert.deepEqual(result.ok && result.value.artifacts.release, retryRelease);
  assert.deepEqual(
    runInputs.map((input) => input.status),
    ["implementing", "needsFeedback"]
  );
});

test("implement issue workflow fails clearly before retry when issue artifact is missing or invalid", async () => {
  const cases = [
    {
      name: "missing",
      runsDirectory: await createIssueArtifactRunDirectory(null),
      expected: /Implement issue artifact not found/
    },
    {
      name: "invalid",
      runsDirectory: await createIssueArtifactRunDirectory("{"),
      expected: /Invalid issue artifact JSON/
    }
  ];

  for (const issueArtifactCase of cases) {
    let agentCalls = 0;

    const result = await runImplementIssueWorkflow(
      {
        ...options,
        runsDirectory: issueArtifactCase.runsDirectory
      },
      {
        agentWorkflow: async () => {
          agentCalls += 1;
          return agentResult();
        },
        verificationRunner: async () =>
          verificationResult({
            status: "failed",
            report: "first failed verification report"
          }),
        gitClient: new FakeGitClient(diffResult()),
        ...artifactWriters()
      }
    );

    assert.equal(result.ok, false, issueArtifactCase.name);
    assert.equal(
      result.ok || result.error.stage,
      "artifact_write",
      issueArtifactCase.name
    );
    assert.match(
      result.ok ? "" : result.error.message,
      issueArtifactCase.expected,
      issueArtifactCase.name
    );
    assert.match(
      result.ok ? "" : result.error.message,
      /issue-65[\\/]+issue\.json/,
      issueArtifactCase.name
    );
    assert.equal(agentCalls, 1, issueArtifactCase.name);
  }
});

test("implement issue workflow does not retry artifact write failures", async () => {
  let agentCalls = 0;

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => {
      agentCalls += 1;
      return agentResult();
    },
    verificationRunner: async () => verificationResult({ status: "failed" }),
    gitClient: new FakeGitClient(diffResult()),
    ...artifactWriters({
      writeVerificationArtifact: async () => {
        throw new Error("verification write failed");
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.equal(result.ok || result.error.message, "verification write failed");
  assert.equal(agentCalls, 1);
});

test("implement issue workflow stops when initial run artifact write fails", async () => {
  let agentCalled = false;

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => {
      agentCalled = true;
      return agentResult();
    },
    gitClient: new FakeGitClient(diffResult()),
    ...artifactWriters({
      updateRunArtifact: async () => {
        throw new Error("run state missing");
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.equal(result.ok || result.error.message, "run state missing");
  assert.equal(agentCalled, false);
});

test("implement issue workflow stops when agent orchestration fails", async () => {
  let verificationCalled = false;
  let diffCalled = false;
  let releaseWritten = false;

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
    ...artifactWriters({
      writeReleaseArtifact: async (input) => {
        releaseWritten = true;
        return releaseArtifactResult(input);
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "agent_orchestration");
  assert.equal(result.ok || result.error.message, "codex failed");
  assert.equal(verificationCalled, false);
  assert.equal(diffCalled, false);
  assert.equal(releaseWritten, false);
});

test("implement issue workflow stops when release artifact writing fails", async () => {
  let verificationCalled = false;

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => {
      verificationCalled = true;
      return verificationResult({ status: "passed" });
    },
    gitClient: new FakeGitClient(diffResult()),
    ...artifactWriters({
      writeReleaseArtifact: async () => {
        throw new Error("release write failed");
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.equal(result.ok || result.error.message, "release write failed");
  assert.equal(verificationCalled, false);
});

test("implement issue workflow leaves only pre-verification artifacts when verification throws", async () => {
  const events: string[] = [];

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => {
      events.push("verification");
      throw new Error("tests crashed");
    },
    gitClient: new FakeGitClient(diffResult(), () => events.push("diff")),
    ...artifactWriters({
      updateRunArtifact: async (input) => {
        events.push(`run:${input.status}`);
        return runArtifactResult(input);
      },
      writeReleaseArtifact: async (input) => {
        events.push("release");
        return releaseArtifactResult(input);
      },
      writeVerificationArtifact: async (input) => {
        events.push("verificationArtifact");
        return verificationArtifactResult(input);
      },
      writeDiffArtifact: async (input) => {
        events.push("diffArtifact");
        return diffArtifactResult(input);
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "verification");
  assert.equal(result.ok || result.error.message, "tests crashed");
  assert.deepEqual(events, ["run:implementing", "release", "verification"]);
});

test("implement issue workflow stops when verification artifact writing fails", async () => {
  let diffCalled = false;

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => verificationResult({ status: "passed" }),
    gitClient: new FakeGitClient(diffResult(), () => {
      diffCalled = true;
    }),
    ...artifactWriters({
      writeVerificationArtifact: async () => {
        throw new Error("verification write failed");
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.equal(result.ok || result.error.message, "verification write failed");
  assert.equal(diffCalled, false);
});

test("implement issue workflow stops without diff or final run write when diff retrieval fails", async () => {
  const events: string[] = [];

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
    ...artifactWriters({
      updateRunArtifact: async (input) => {
        events.push(`run:${input.status}`);
        return runArtifactResult(input);
      },
      writeReleaseArtifact: async (input) => {
        events.push("release");
        return releaseArtifactResult(input);
      },
      writeVerificationArtifact: async (input) => {
        events.push("verificationArtifact");
        return verificationArtifactResult(input);
      },
      writeDiffArtifact: async (input) => {
        events.push("diffArtifact");
        return diffArtifactResult(input);
      }
    })
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      stage: "diff",
      code: "unknown",
      message: "git diff failed"
    }
  });
  assert.deepEqual(events, ["run:implementing", "release", "verificationArtifact"]);
});

test("implement issue workflow returns diff artifact write failures", async () => {
  let finalRunWritten = false;

  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => verificationResult({ status: "passed" }),
    gitClient: new FakeGitClient(diffResult()),
    ...artifactWriters({
      writeDiffArtifact: async () => {
        throw new Error("diff write failed");
      },
      updateRunArtifact: async (input) => {
        if (input.status === "needsFeedback") {
          finalRunWritten = true;
        }
        return runArtifactResult(input);
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.equal(result.ok || result.error.message, "diff write failed");
  assert.equal(finalRunWritten, false);
});

test("implement issue workflow returns final run artifact write failures", async () => {
  const result = await runImplementIssueWorkflow(options, {
    agentWorkflow: async () => agentResult(),
    verificationRunner: async () => verificationResult({ status: "passed" }),
    gitClient: new FakeGitClient(diffResult()),
    ...artifactWriters({
      updateRunArtifact: async (input) => {
        if (input.status === "needsFeedback") {
          throw new Error("final run write failed");
        }
        return runArtifactResult(input);
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "artifact_write");
  assert.equal(result.ok || result.error.message, "final run write failed");
});

function artifactWriters(
  overrides: Partial<ImplementIssueWorkflowDependencies> = {}
): ImplementIssueWorkflowDependencies {
  return {
    updateRunArtifact: async (input) => runArtifactResult(input),
    writeReleaseArtifact: async (input) => releaseArtifactResult(input),
    writeVerificationArtifact: async (input) => verificationArtifactResult(input),
    writeDiffArtifact: async (input) => diffArtifactResult(input),
    ...overrides
  };
}

function agentResult(
  releaseMetadata: ImplementorReleaseMetadata = release
): ImplementWorkflowResult {
  return {
    ok: true,
    value: {
      release: releaseMetadata
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
  report?: string;
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
    report: input.report ?? "rendered verification report"
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

function releaseArtifactResult(
  input: WriteReleaseArtifactInput
): WriteReleaseArtifactResult {
  const runDirectory = runDirectoryFor(input);
  return {
    runDirectory,
    releasePath: `${runDirectory}/release.json`,
    release: input.release
  };
}

function verificationArtifactResult(
  input: WriteVerificationArtifactInput
): WriteVerificationArtifactResult {
  const runDirectory = runDirectoryFor(input);
  return {
    runDirectory,
    verificationOutputPath: `${runDirectory}/verification.txt`
  };
}

function diffArtifactResult(input: WriteDiffArtifactInput): WriteDiffArtifactResult {
  const runDirectory = runDirectoryFor(input);
  return {
    runDirectory,
    diffPath: `${runDirectory}/diff.patch`
  };
}

function runArtifactResult(input: UpdateRunArtifactInput): UpdateRunArtifactResult {
  const runDirectory = runDirectoryFor(input);
  return {
    runDirectory,
    runPath: `${runDirectory}/run.json`,
    run: {
      status: input.status ?? "needsFeedback"
    }
  };
}

function runDirectoryFor(input: { issueNumber: number; runsDirectory?: string }): string {
  return `${input.runsDirectory ?? ".runs"}/issue-${input.issueNumber}`;
}

async function createIssueArtifactRunDirectory(
  issueContent: string | null = JSON.stringify({
    number: options.issueNumber,
    title: "Local retry issue title",
    body: "Local retry issue body."
  })
): Promise<string> {
  const runsDirectory = await mkdtemp(join(tmpdir(), "implement-retry-"));
  const runDirectory = join(runsDirectory, `issue-${options.issueNumber}`);
  await mkdir(runDirectory, { recursive: true });
  if (issueContent !== null) {
    await writeFile(join(runDirectory, "issue.json"), issueContent, "utf8");
  }
  return runsDirectory;
}
