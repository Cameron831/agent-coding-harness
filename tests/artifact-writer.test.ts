import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadPrepareRunState,
  updatePrepareRunArtifact as updateRunArtifact,
  writeIssueArtifact,
  writePromptArtifact,
  writeRunArtifact,
  type IssueDetails
} from "../src/index.js";

const baseIssue: IssueDetails = {
  issueNumber: 42,
  title: "Add prepare artifact writer",
  body: "Approved issue body",
  url: "https://github.com/example/repo/issues/42",
  state: "open"
};

test("writeIssueArtifact writes issue artifact under the issue run directory", async () => {
  await withTempCwd(async (root) => {
    const result = await writeIssueArtifact({
      issue: baseIssue
    });

    assert.equal(result.runDirectory, path.join(".runs", "issue-42"));
    assert.equal(result.issuePath, path.join(result.runDirectory, "issue.json"));
    assert.deepEqual(result.issue, {
      number: 42,
      title: "Add prepare artifact writer",
      body: "Approved issue body"
    });
    assert.equal(
      await readFile(path.join(root, result.issuePath), "utf8"),
      '{\n  "number": 42,\n  "title": "Add prepare artifact writer",\n  "body": "Approved issue body"\n}\n'
    );
  });
});

test("writePromptArtifact writes prompt content exactly", async () => {
  await withTempCwd(async (root) => {
    const prompt = "Line one\r\nLine two\n\nFinal line";
    const result = await writePromptArtifact({
      issueNumber: 42,
      prompt
    });

    assert.equal(result.runDirectory, path.join(".runs", "issue-42"));
    assert.equal(result.promptPath, path.join(result.runDirectory, "prompt.md"));
    assert.equal(await readFile(path.join(root, result.promptPath), "utf8"), prompt);
  });
});

test("writePromptArtifact writes under a custom runs directory", async () => {
  await withTempCwd(async (root) => {
    const result = await writePromptArtifact({
      issueNumber: 42,
      prompt: "custom prompt",
      runsDirectory: "custom-runs"
    });

    assert.equal(result.runDirectory, path.join("custom-runs", "issue-42"));
    assert.equal(
      await readFile(path.join(root, result.promptPath), "utf8"),
      "custom prompt"
    );
  });
});

test("writeIssueArtifact creates nested run directories recursively", async () => {
  await withTempCwd(async (root) => {
    const result = await writeIssueArtifact({
      issue: baseIssue,
      runsDirectory: path.join("nested", "runs")
    });

    const directoryStats = await stat(path.join(root, result.runDirectory));
    assert.equal(directoryStats.isDirectory(), true);
  });
});

test("writeIssueArtifact falls back to empty issue body", async () => {
  await withTempCwd(async () => {
    const result = await writeIssueArtifact({
      issue: { ...baseIssue, body: undefined }
    });

    assert.deepEqual(result.issue, {
      number: 42,
      title: "Add prepare artifact writer",
      body: ""
    });
  });
});

test("writeRunArtifact creates an initial preparing run artifact", async () => {
  await withTempCwd(async (root) => {
    const result = await writeRunArtifact({
      issueNumber: 42
    });

    assert.equal(result.runDirectory, path.join(".runs", "issue-42"));
    assert.equal(result.runPath, path.join(result.runDirectory, "run.json"));
    assert.deepEqual(result.run, {
      status: "preparing"
    });
    assert.equal(
      await readFile(path.join(root, result.runPath), "utf8"),
      '{\n  "status": "preparing"\n}\n'
    );
  });
});

test("loadPrepareRunState computes paths and returns an existing run without writing", async () => {
  await withTempCwd(async (root) => {
    const runDirectory = path.join(root, "custom-runs", "issue-42");
    const runPath = path.join(runDirectory, "run.json");
    await writeRunArtifact({
      issueNumber: 42,
      runsDirectory: "custom-runs"
    });
    await writeFile(
      runPath,
      `${JSON.stringify({ status: "prepared", issueNumber: 42 }, null, 2)}\n`,
      "utf8"
    );

    const result = await loadPrepareRunState({
      issueNumber: 42,
      runsDirectory: "custom-runs"
    });

    assert.deepEqual(result, {
      paths: {
        runDirectory: path.join("custom-runs", "issue-42"),
        promptPath: path.join("custom-runs", "issue-42", "prompt.md"),
        issuePath: path.join("custom-runs", "issue-42", "issue.json"),
        runPath: path.join("custom-runs", "issue-42", "run.json")
      },
      run: {
        status: "prepared",
        issueNumber: 42
      }
    });
    assert.equal(
      await readFile(runPath, "utf8"),
      '{\n  "status": "prepared",\n  "issueNumber": 42\n}\n'
    );
  });
});

test("loadPrepareRunState fails clearly for malformed and non-object run artifacts", async () => {
  await withTempCwd(async (root) => {
    const runDirectory = path.join(root, ".runs", "issue-42");
    await writeRunArtifact({
      issueNumber: 42
    });
    await writeFile(path.join(runDirectory, "run.json"), "not json", "utf8");

    await assert.rejects(
      loadPrepareRunState({
        issueNumber: 42
      }),
      /Existing prepare run artifact at .*run\.json must be valid JSON\./
    );

    await writeFile(path.join(runDirectory, "run.json"), "[]", "utf8");
    await assert.rejects(
      loadPrepareRunState({
        issueNumber: 42
      }),
      /Existing prepare run artifact at .*run\.json must be a JSON object\./
    );
  });
});

test("writeRunArtifact fails clearly when replacing a malformed run artifact", async () => {
  await withTempCwd(async (root) => {
    const runDirectory = path.join(root, ".runs", "issue-42");
    await writeRunArtifact({
      issueNumber: 42
    });
    await writeFile(path.join(runDirectory, "run.json"), "not json", "utf8");

    await assert.rejects(
      writeRunArtifact({
        issueNumber: 42
      }),
      /Existing prepare run artifact at .*run\.json must be valid JSON\./
    );
  });
});

test("updateRunArtifact preserves existing fields while adding supplied fields", async () => {
  await withTempCwd(async (root) => {
    await writeRunArtifact({
      issueNumber: 42
    });
    await updateRunArtifact({
      issueNumber: 42,
      issue: baseIssue
    });
    await updateRunArtifact({
      issueNumber: 42,
      worktreePath: "/worktrees/issue-42",
      branchName: "42-add-prepare-artifact-writer"
    });
    await updateRunArtifact({
      issueNumber: 42,
      beforeHead: "abc123before"
    });
    const result = await updateRunArtifact({
      issueNumber: 42,
      status: "prepared"
    });

    assert.deepEqual(result.run, {
      status: "prepared",
      issueURL: "https://github.com/example/repo/issues/42",
      issueTitle: "Add prepare artifact writer",
      issueNumber: 42,
      worktreePath: "/worktrees/issue-42",
      branch: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before"
    });
    assert.equal(
      await readFile(path.join(root, result.runPath), "utf8"),
      '{\n  "status": "prepared",\n  "issueURL": "https://github.com/example/repo/issues/42",\n  "issueTitle": "Add prepare artifact writer",\n  "issueNumber": 42,\n  "worktreePath": "/worktrees/issue-42",\n  "branch": "42-add-prepare-artifact-writer",\n  "beforeHead": "abc123before"\n}\n'
    );
  });
});

test("updateRunArtifact can write beforeHead and prepared status together", async () => {
  await withTempCwd(async (root) => {
    await writeRunArtifact({
      issueNumber: 42
    });
    await updateRunArtifact({
      issueNumber: 42,
      issue: baseIssue
    });
    await updateRunArtifact({
      issueNumber: 42,
      worktreePath: "/worktrees/issue-42",
      branchName: "42-add-prepare-artifact-writer"
    });
    const result = await updateRunArtifact({
      issueNumber: 42,
      beforeHead: "abc123before",
      status: "prepared"
    });

    assert.deepEqual(result.run, {
      status: "prepared",
      issueURL: "https://github.com/example/repo/issues/42",
      issueTitle: "Add prepare artifact writer",
      issueNumber: 42,
      worktreePath: "/worktrees/issue-42",
      branch: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before"
    });
    assert.equal(
      await readFile(path.join(root, result.runPath), "utf8"),
      '{\n  "status": "prepared",\n  "issueURL": "https://github.com/example/repo/issues/42",\n  "issueTitle": "Add prepare artifact writer",\n  "issueNumber": 42,\n  "worktreePath": "/worktrees/issue-42",\n  "branch": "42-add-prepare-artifact-writer",\n  "beforeHead": "abc123before"\n}\n'
    );
  });
});

test("updateRunArtifact fails clearly when existing run artifact is malformed", async () => {
  await withTempCwd(async (root) => {
    const runDirectory = path.join(root, ".runs", "issue-42");
    await writeRunArtifact({
      issueNumber: 42
    });
    await writeFile(path.join(runDirectory, "run.json"), "not json", "utf8");

    await assert.rejects(
      updateRunArtifact({
        issueNumber: 42,
        status: "prepared"
      }),
      /Existing prepare run artifact at .*run\.json must be valid JSON\./
    );
  });
});

async function withTempCwd(
  callback: (root: string) => Promise<void>
): Promise<void> {
  const originalCwd = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), "artifact-writer-"));

  process.chdir(root);
  try {
    await callback(root);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
}
