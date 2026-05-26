import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  setupEvalWorkspace,
  type EvalWorkspaceGitCommand,
  type EvalWorkspaceGitRunner
} from "../evals/workspace.js";

test("setupEvalWorkspace copies fixtures and runs baseline git commands", async () => {
  await withTemporaryRepository(async (repositoryRoot) => {
    const caseID = "copy-fixture";
    const runID = "run-1";
    const evalParentPath = join(repositoryRoot, "eval-temp");
    const tempPath = join(
      evalParentPath,
      "agent-workforce-evals",
      caseID,
      runID
    );
    await writeFixture(repositoryRoot, caseID);

    const gitRunner = new RecordingGitRunner(async (command) => {
      assert.equal(command.cwd, tempPath);
      await access(join(tempPath, "package.json"));
      await access(join(tempPath, "src", "index.ts"));
    });

    const result = await setupEvalWorkspace(
      { caseID, runID, evalParentPath, repositoryRoot },
      { gitRunner }
    );

    assert.deepEqual(result, { tempPath });
    assert.equal(
      await readFile(join(tempPath, "package.json"), "utf8"),
      '{"name":"fixture"}\n'
    );
    assert.equal(
      await readFile(join(tempPath, "src", "index.ts"), "utf8"),
      "export const value = 1;\n"
    );
    assert.deepEqual(gitRunner.commands, [
      { cwd: tempPath, args: ["init"] },
      { cwd: tempPath, args: ["add", "."] },
      { cwd: tempPath, args: ["commit", "-m", "fixture baseline"] }
    ]);
  });
});

test("setupEvalWorkspace fails clearly when the fixture directory is missing", async () => {
  await withTemporaryRepository(async (repositoryRoot) => {
    await assert.rejects(
      setupEvalWorkspace({
        caseID: "missing-fixture",
        runID: "run-1",
        evalParentPath: join(repositoryRoot, "eval-temp"),
        repositoryRoot
      }),
      /Missing eval fixture directory/
    );
  });
});

test("setupEvalWorkspace fails clearly when the workspace already exists", async () => {
  await withTemporaryRepository(async (repositoryRoot) => {
    const caseID = "existing-target";
    const runID = "run-1";
    const evalParentPath = join(repositoryRoot, "eval-temp");
    await writeFixture(repositoryRoot, caseID);
    await mkdir(join(evalParentPath, "agent-workforce-evals", caseID, runID), {
      recursive: true
    });

    await assert.rejects(
      setupEvalWorkspace({ caseID, runID, evalParentPath, repositoryRoot }),
      /Eval workspace already exists/
    );
  });
});

test("setupEvalWorkspace stops and reports git command failures", async () => {
  await withTemporaryRepository(async (repositoryRoot) => {
    const caseID = "git-failure";
    const runID = "run-1";
    const evalParentPath = join(repositoryRoot, "eval-temp");
    const gitRunner = new RecordingGitRunner(async (command) => {
      if (command.args[0] === "add") {
        throw new Error("add failed");
      }
    });
    await writeFixture(repositoryRoot, caseID);

    await assert.rejects(
      setupEvalWorkspace(
        { caseID, runID, evalParentPath, repositoryRoot },
        { gitRunner }
      ),
      /Unable to run git add \./
    );
    assert.deepEqual(
      gitRunner.commands.map((command) => command.args),
      [["init"], ["add", "."]]
    );
  });
});

class RecordingGitRunner implements EvalWorkspaceGitRunner {
  readonly commands: EvalWorkspaceGitCommand[] = [];

  constructor(
    private readonly onRun: (command: EvalWorkspaceGitCommand) => Promise<void> | void
  ) {}

  async run(command: EvalWorkspaceGitCommand): Promise<void> {
    const recorded = {
      cwd: command.cwd,
      args: [...command.args]
    };
    this.commands.push(recorded);
    await this.onRun(recorded);
  }
}

async function writeFixture(repositoryRoot: string, caseID: string): Promise<void> {
  const fixturePath = join(repositoryRoot, "evals", caseID, "fixture");
  await mkdir(join(fixturePath, "src"), { recursive: true });
  await writeFile(join(fixturePath, "package.json"), '{"name":"fixture"}\n', "utf8");
  await writeFile(
    join(fixturePath, "src", "index.ts"),
    "export const value = 1;\n",
    "utf8"
  );
}

async function withTemporaryRepository<T>(
  callback: (repositoryRoot: string) => Promise<T>
): Promise<T> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "eval-workspace-"));

  try {
    return await callback(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}
