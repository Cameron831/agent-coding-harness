import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runEvalCase,
  type EvalAgentOrchestrationInput,
  type EvalRunContext
} from "../evals/run.js";

const caseID = "worktree-cleanup-idempotency";
const fixedDate = new Date("2026-05-20T21:30:04.005Z");
const startedAt = fixedDate.toISOString();
const runID = "2026-05-20T21-30-04-005Z";

test("eval runner sequences placeholders with deterministic paths and summary output", async () => {
  await withTemporaryRepository(async (repositoryRoot) => {
    await writeEvalCase(repositoryRoot, caseID, validCase());

    const events: string[] = [];
    const stdout: string[] = [];
    const expectedOutputsPath = join("evals", caseID, "outputs", runID);
    const expectedPromptPath = join("evals", caseID, "prompt.md");
    let workspaceContext: EvalRunContext | undefined;
    let agentInput: EvalAgentOrchestrationInput | undefined;
    let gradingInput: EvalAgentOrchestrationInput | undefined;

    const exitCode = await runEvalCase(caseID, {
      repositoryRoot,
      clock: () => fixedDate,
      stdout: (message) => stdout.push(message),
      setupWorkspace: async (context) => {
        events.push("workspace");
        await access(join(repositoryRoot, expectedOutputsPath));
        workspaceContext = context;
        return {
          ok: true,
          value: {
            targetWorktreePath: join(repositoryRoot, "target-worktree")
          }
        };
      },
      runAgent: async (input) => {
        events.push("agent");
        agentInput = input;
        return { ok: true };
      },
      grade: async (input) => {
        events.push("grading");
        gradingInput = input;
        return {
          ok: true,
          value: {
            status: "success"
          }
        };
      }
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(events, ["workspace", "agent", "grading"]);
    assert.deepEqual(workspaceContext, {
      case: validCase(),
      caseID,
      runID,
      startedAt,
      outputsPath: expectedOutputsPath,
      promptPath: expectedPromptPath
    });
    assert.equal(
      agentInput?.targetWorktreePath,
      join(repositoryRoot, "target-worktree")
    );
    assert.equal(
      gradingInput?.targetWorktreePath,
      join(repositoryRoot, "target-worktree")
    );
    assert.equal(agentInput?.outputsPath, expectedOutputsPath);
    assert.equal(stdout.length, 1);
    assert.match(stdout[0], /Eval run summary/);
    assert.match(stdout[0], new RegExp(`Case ID: ${caseID}`));
    assert.match(stdout[0], new RegExp(`Run ID: ${runID}`));
    assert.match(stdout[0], new RegExp(`Started: ${startedAt}`));
    assert.match(stdout[0], /Status: success/);
    assert.doesNotMatch(stdout[0], /Failure:/);
  });
});

test("eval runner rejects missing input before invoking placeholders", async () => {
  let invoked = false;
  const stdout: string[] = [];

  const exitCode = await runEvalCase("", {
    stdout: (message) => stdout.push(message),
    setupWorkspace: async () => {
      invoked = true;
      return {
        ok: true,
        value: {
          targetWorktreePath: "unused"
        }
      };
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(invoked, false);
  assert.match(stdout.join("\n"), /Case ID: \(missing\)/);
  assert.match(stdout.join("\n"), /Status: failed/);
  assert.match(stdout.join("\n"), /caseID is required/);
});

test("eval runner rejects invalid case metadata", async () => {
  const invalidCases: Array<{
    name: string;
    metadata: unknown;
    expected: RegExp;
  }> = [
    {
      name: "missing id",
      metadata: {
        testCommand: "npm test",
        allowedChangedFiles: []
      },
      expected: /string id/
    },
    {
      name: "invalid id",
      metadata: {
        id: 7,
        testCommand: "npm test",
        allowedChangedFiles: []
      },
      expected: /string id/
    },
    {
      name: "missing testCommand",
      metadata: {
        id: caseID,
        allowedChangedFiles: []
      },
      expected: /string testCommand/
    },
    {
      name: "invalid testCommand",
      metadata: {
        id: caseID,
        testCommand: 7,
        allowedChangedFiles: []
      },
      expected: /string testCommand/
    },
    {
      name: "missing allowedChangedFiles",
      metadata: {
        id: caseID,
        testCommand: "npm test"
      },
      expected: /string array allowedChangedFiles/
    },
    {
      name: "invalid allowedChangedFiles",
      metadata: {
        id: caseID,
        testCommand: "npm test",
        allowedChangedFiles: "src/git/git-client.ts"
      },
      expected: /string array allowedChangedFiles/
    },
    {
      name: "invalid allowedChangedFiles entry",
      metadata: {
        id: caseID,
        testCommand: "npm test",
        allowedChangedFiles: ["src/git/git-client.ts", 7]
      },
      expected: /string array allowedChangedFiles/
    },
    {
      name: "id mismatch",
      metadata: {
        id: "different-case",
        testCommand: "npm test",
        allowedChangedFiles: []
      },
      expected: /does not match requested caseID/
    }
  ];

  for (const invalidCase of invalidCases) {
    await withTemporaryRepository(async (repositoryRoot) => {
      await writeEvalCase(repositoryRoot, caseID, invalidCase.metadata);
      let invoked = false;
      const stdout: string[] = [];

      const exitCode = await runEvalCase(caseID, {
        repositoryRoot,
        clock: () => fixedDate,
        stdout: (message) => stdout.push(message),
        setupWorkspace: async () => {
          invoked = true;
          return {
            ok: true,
            value: {
              targetWorktreePath: "unused"
            }
          };
        }
      });

      assert.equal(exitCode, 1, invalidCase.name);
      assert.equal(invoked, false, invalidCase.name);
      assert.match(stdout.join("\n"), invalidCase.expected, invalidCase.name);
      assert.match(stdout.join("\n"), /Status: failed/, invalidCase.name);
      assert.match(stdout.join("\n"), new RegExp(`Run ID: ${runID}`));
    });
  }
});

test("eval runner short-circuits after workspace setup failure", async () => {
  await withTemporaryRepository(async (repositoryRoot) => {
    await writeEvalCase(repositoryRoot, caseID, validCase());
    const events: string[] = [];
    const stdout: string[] = [];

    const exitCode = await runEvalCase(caseID, {
      repositoryRoot,
      clock: () => fixedDate,
      stdout: (message) => stdout.push(message),
      setupWorkspace: async () => {
        events.push("workspace");
        return {
          ok: false,
          reason: "fixture setup failed"
        };
      },
      runAgent: async () => {
        events.push("agent");
        return { ok: true };
      },
      grade: async () => {
        events.push("grading");
        return {
          ok: true,
          value: {
            status: "success"
          }
        };
      }
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(events, ["workspace"]);
    assert.match(stdout.join("\n"), /Workspace setup failed: fixture setup failed/);
  });
});

test("eval runner short-circuits after agent orchestration failure", async () => {
  await withTemporaryRepository(async (repositoryRoot) => {
    await writeEvalCase(repositoryRoot, caseID, validCase());
    const events: string[] = [];
    const stdout: string[] = [];

    const exitCode = await runEvalCase(caseID, {
      repositoryRoot,
      clock: () => fixedDate,
      stdout: (message) => stdout.push(message),
      setupWorkspace: async () => {
        events.push("workspace");
        return {
          ok: true,
          value: {
            targetWorktreePath: "target-worktree"
          }
        };
      },
      runAgent: async () => {
        events.push("agent");
        return {
          ok: false,
          reason: "agent failed"
        };
      },
      grade: async () => {
        events.push("grading");
        return {
          ok: true,
          value: {
            status: "success"
          }
        };
      }
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(events, ["workspace", "agent"]);
    assert.match(stdout.join("\n"), /Agent orchestration failed: agent failed/);
  });
});

test("eval runner returns failure when grading execution fails", async () => {
  await withTemporaryRepository(async (repositoryRoot) => {
    await writeEvalCase(repositoryRoot, caseID, validCase());
    const stdout: string[] = [];

    const exitCode = await runEvalCase(caseID, {
      repositoryRoot,
      clock: () => fixedDate,
      stdout: (message) => stdout.push(message),
      setupWorkspace: async () => ({
        ok: true,
        value: {
          targetWorktreePath: "target-worktree"
        }
      }),
      runAgent: async () => ({ ok: true }),
      grade: async () => {
        throw new Error("grader crashed");
      }
    });

    assert.equal(exitCode, 1);
    assert.match(stdout.join("\n"), /Grading failed: grader crashed/);
    assert.match(stdout.join("\n"), /Status: failed/);
  });
});

test("eval runner reports non-success grading status without failing the run", async () => {
  await withTemporaryRepository(async (repositoryRoot) => {
    await writeEvalCase(repositoryRoot, caseID, validCase());
    const stdout: string[] = [];

    const exitCode = await runEvalCase(caseID, {
      repositoryRoot,
      clock: () => fixedDate,
      stdout: (message) => stdout.push(message),
      setupWorkspace: async () => ({
        ok: true,
        value: {
          targetWorktreePath: "target-worktree"
        }
      }),
      runAgent: async () => ({ ok: true }),
      grade: async () => ({
        ok: true,
        value: {
          status: "failed",
          reason: "changed files outside allowlist"
        }
      })
    });

    assert.equal(exitCode, 0);
    assert.match(stdout.join("\n"), /changed files outside allowlist/);
    assert.match(stdout.join("\n"), /Status: success/);
    assert.match(stdout.join("\n"), /Grading: failed/);
    assert.doesNotMatch(stdout.join("\n"), /Failure:/);
  });
});

function validCase() {
  return {
    id: caseID,
    testCommand: "npm test",
    allowedChangedFiles: ["src/git/git-client.ts"]
  };
}

async function writeEvalCase(
  repositoryRoot: string,
  id: string,
  metadata: unknown
): Promise<void> {
  const caseDirectory = join(repositoryRoot, "evals", id);
  await mkdir(caseDirectory, { recursive: true });
  await writeFile(join(caseDirectory, "case.json"), formatJson(metadata), "utf8");
  await writeFile(join(caseDirectory, "prompt.md"), "Implement the eval case.", "utf8");
}

async function withTemporaryRepository<T>(
  callback: (repositoryRoot: string) => Promise<T>
): Promise<T> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "eval-run-"));

  try {
    return await callback(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
