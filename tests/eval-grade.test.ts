import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  gradeEvalRun,
  type EvalGradeCaseMetadata,
  type EvalGradeClock,
  type EvalGradeCommandInput,
  type EvalGradeCommandResult,
  type EvalGradeCommandRunner,
  type EvalGradeGitChangedFilesResult,
  type EvalGradeGitDiffResult,
  type EvalGradeGitInput,
  type EvalGradeGitReader,
  type EvalGradeInput
} from "../evals/grade.js";

const startedAt = "2026-05-22T19:00:00.000Z";
const finishedAt = "2026-05-22T19:00:05.000Z";
const release = {
  commit_message: "Add grader",
  pull_request: {
    title: "Add grader",
    summary: "Adds eval grading.",
    scope: ["Added grader."],
    verification: ["Not run."]
  }
};

test("gradeEvalRun writes passing artifacts and report", async () => {
  await withTemporaryDirectory(async (root) => {
    const promptBytes = Buffer.from("Prompt line 1\r\nPrompt line 2\n", "utf8");
    const input = await writeGradeInput(root, {
      promptBytes,
      caseMetadata: {
        id: "case-1",
        testCommand: "npm test",
        allowedChangedFiles: ["src/index.ts", "package.json"]
      }
    });
    const diff = "diff --git a/src/index.ts b/src/index.ts\n+export const x = 1;";
    const events: string[] = [];
    const gitClient = new FakeGitReader(
      { ok: true, value: { diff } },
      {
        ok: true,
        value: {
          files: ["src/index.ts", "package.json"]
        }
      },
      events
    );
    const commandRunner = new FakeCommandRunner(
      {
        command: "ignored",
        exitCode: 0,
        output: "ok\nstderr line\n"
      },
      events,
      async () => {
        await access(join(input.outputsPath, "diff.patch"));
        await access(join(input.outputsPath, "files-changes.json"));
      }
    );

    const result = await gradeEvalRun(input, {
      gitClient,
      commandRunner,
      clock: new FixedClock(finishedAt)
    });

    assert.equal(result.status, "pass");
    assert.deepEqual(events, ["diff", "files", "command"]);
    assert.deepEqual(gitClient.diffInputs, [
      { targetWorktreePath: input.tempPath }
    ]);
    assert.deepEqual(gitClient.changedFilesInputs, [
      { targetWorktreePath: input.tempPath }
    ]);
    assert.deepEqual(commandRunner.inputs, [
      {
        command: "npm ci && npm test",
        cwd: input.tempPath
      }
    ]);

    assert.equal(
      await readFile(join(input.outputsPath, "release.json"), "utf8"),
      `${JSON.stringify(release, null, 2)}\n`
    );
    assert.deepEqual(
      await readFile(join(input.outputsPath, "prompt.md")),
      promptBytes
    );
    assert.equal(await readFile(join(input.outputsPath, "diff.patch"), "utf8"), diff);
    assert.deepEqual(await readJson(join(input.outputsPath, "files-changes.json")), {
      changedFiles: ["src/index.ts", "package.json"],
      disallowedChangedFiles: []
    });
    assert.equal(
      await readFile(join(input.outputsPath, "test-output.txt"), "utf8"),
      "Command: npm ci && npm test\nExit Code: 0\nRaw Output:\nok\nstderr line\n"
    );

    const expectedReport = {
      caseId: "case-1",
      runId: "run-1",
      status: "pass",
      startedAt,
      finishedAt,
      checks: [
        { name: "non-empty-diff", status: "pass" },
        { name: "allowed-changed-files", status: "pass" },
        { name: "tests", status: "pass" }
      ],
      changedFiles: ["src/index.ts", "package.json"],
      testCommand: "npm test",
      allowedChangedFiles: ["src/index.ts", "package.json"]
    };
    assert.deepEqual(result.report, expectedReport);
    assert.deepEqual(await readJson(join(input.outputsPath, "report.json")), expectedReport);
  });
});

test("gradeEvalRun fails non-empty-diff for whitespace-only diffs", async () => {
  await withTemporaryDirectory(async (root) => {
    const input = await writeGradeInput(root);

    const result = await gradeEvalRun(input, {
      gitClient: new FakeGitReader(
        { ok: true, value: { diff: " \n\t" } },
        { ok: true, value: { files: ["src/index.ts"] } }
      ),
      commandRunner: new FakeCommandRunner({
        command: "ignored",
        exitCode: 0,
        output: "ok\n"
      }),
      clock: new FixedClock(finishedAt)
    });

    assert.equal(result.status, "fail");
    assert.deepEqual(
      result.report.checks.map((check) => [check.name, check.status]),
      [
        ["non-empty-diff", "fail"],
        ["allowed-changed-files", "pass"],
        ["tests", "pass"]
      ]
    );
    assert.equal(
      (await readJson(join(input.outputsPath, "report.json")) as { status: string })
        .status,
      "fail"
    );
  });
});

test("gradeEvalRun reports disallowed normalized changed files", async () => {
  await withTemporaryDirectory(async (root) => {
    const input = await writeGradeInput(root, {
      caseMetadata: {
        id: "case-1",
        testCommand: "npm test",
        allowedChangedFiles: ["src\\index.ts"]
      }
    });

    const result = await gradeEvalRun(input, {
      gitClient: new FakeGitReader(
        { ok: true, value: { diff: "diff\n" } },
        {
          ok: true,
          value: {
            files: ["src\\index.ts", "docs\\readme.md"]
          }
        }
      ),
      commandRunner: new FakeCommandRunner({
        command: "ignored",
        exitCode: 0,
        output: "ok\n"
      }),
      clock: new FixedClock(finishedAt)
    });

    assert.equal(result.status, "fail");
    assert.deepEqual(result.fileChanges, {
      changedFiles: ["src/index.ts", "docs/readme.md"],
      disallowedChangedFiles: ["docs/readme.md"]
    });
    assert.deepEqual(
      result.report.checks.map((check) => [check.name, check.status]),
      [
        ["non-empty-diff", "pass"],
        ["allowed-changed-files", "fail"],
        ["tests", "pass"]
      ]
    );
    assert.deepEqual(await readJson(join(input.outputsPath, "files-changes.json")), {
      changedFiles: ["src/index.ts", "docs/readme.md"],
      disallowedChangedFiles: ["docs/readme.md"]
    });
  });
});

test("gradeEvalRun fails tests check and persists raw command output", async () => {
  await withTemporaryDirectory(async (root) => {
    const input = await writeGradeInput(root);
    const rawOutput = "failed test output\n\nstderr line\n";

    const result = await gradeEvalRun(input, {
      gitClient: new FakeGitReader(
        { ok: true, value: { diff: "diff\n" } },
        { ok: true, value: { files: ["src/index.ts"] } }
      ),
      commandRunner: new FakeCommandRunner({
        command: "ignored",
        exitCode: 2,
        output: rawOutput
      }),
      clock: new FixedClock(finishedAt)
    });

    assert.equal(result.status, "fail");
    assert.deepEqual(
      result.report.checks.map((check) => [check.name, check.status]),
      [
        ["non-empty-diff", "pass"],
        ["allowed-changed-files", "pass"],
        ["tests", "fail"]
      ]
    );
    assert.equal(
      await readFile(join(input.outputsPath, "test-output.txt"), "utf8"),
      `Command: npm ci && npm test\nExit Code: 2\nRaw Output:\n${rawOutput}`
    );
  });
});

test("gradeEvalRun fails clearly when git diff cannot be read", async () => {
  await withTemporaryDirectory(async (root) => {
    const input = await writeGradeInput(root);
    const commandRunner = new FakeCommandRunner({
      command: "ignored",
      exitCode: 0,
      output: "ok\n"
    });

    await assert.rejects(
      gradeEvalRun(input, {
        gitClient: new FakeGitReader(
          {
            ok: false,
            error: {
              message: "fatal: not a git repository"
            }
          },
          { ok: true, value: { files: ["src/index.ts"] } }
        ),
        commandRunner,
        clock: new FixedClock(finishedAt)
      }),
      /Unable to read diff.*fatal: not a git repository/
    );
    assert.deepEqual(commandRunner.inputs, []);
  });
});

test("gradeEvalRun fails clearly when an artifact cannot be written", async () => {
  await withTemporaryDirectory(async (root) => {
    const input = await writeGradeInput(root);
    await rm(input.promptPath, { force: true });

    await assert.rejects(
      gradeEvalRun(input, {
        gitClient: new FakeGitReader(
          { ok: true, value: { diff: "diff\n" } },
          { ok: true, value: { files: ["src/index.ts"] } }
        ),
        commandRunner: new FakeCommandRunner({
          command: "ignored",
          exitCode: 0,
          output: "ok\n"
        }),
        clock: new FixedClock(finishedAt)
      }),
      /Unable to copy prompt artifact/
    );
  });
});

class FakeGitReader implements EvalGradeGitReader {
  readonly diffInputs: EvalGradeGitInput[] = [];
  readonly changedFilesInputs: EvalGradeGitInput[] = [];

  constructor(
    private readonly diffResult: EvalGradeGitDiffResult,
    private readonly changedFilesResult: EvalGradeGitChangedFilesResult,
    private readonly events: string[] = []
  ) {}

  async getDiff(input: EvalGradeGitInput): Promise<EvalGradeGitDiffResult> {
    this.diffInputs.push(input);
    this.events.push("diff");
    return this.diffResult;
  }

  async getChangedFiles(
    input: EvalGradeGitInput
  ): Promise<EvalGradeGitChangedFilesResult> {
    this.changedFilesInputs.push(input);
    this.events.push("files");
    return this.changedFilesResult;
  }
}

class FakeCommandRunner implements EvalGradeCommandRunner {
  readonly inputs: EvalGradeCommandInput[] = [];

  constructor(
    private readonly result: EvalGradeCommandResult,
    private readonly events: string[] = [],
    private readonly onRun: () => Promise<void> | void = () => {}
  ) {}

  async run(input: EvalGradeCommandInput): Promise<EvalGradeCommandResult> {
    this.inputs.push(input);
    this.events.push("command");
    await this.onRun();
    return this.result;
  }
}

class FixedClock implements EvalGradeClock {
  constructor(private readonly timestamp: string) {}

  now(): Date {
    return new Date(this.timestamp);
  }
}

async function writeGradeInput(
  root: string,
  options: {
    promptBytes?: Buffer;
    caseMetadata?: EvalGradeCaseMetadata;
  } = {}
): Promise<EvalGradeInput> {
  const promptPath = join(root, "prompt.md");
  const tempPath = join(root, "temp");
  const outputsPath = join(root, "outputs");
  const caseMetadata = options.caseMetadata ?? {
    id: "case-1",
    testCommand: "npm test",
    allowedChangedFiles: ["src/index.ts"]
  };

  await mkdir(tempPath, { recursive: true });
  await writeFile(
    promptPath,
    options.promptBytes ?? Buffer.from("Implement the eval case.", "utf8")
  );

  return {
    caseID: caseMetadata.id,
    runID: "run-1",
    startedAt,
    case: caseMetadata,
    release,
    promptPath,
    tempPath,
    outputsPath
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function withTemporaryDirectory<T>(
  callback: (directory: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "eval-grade-"));

  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
