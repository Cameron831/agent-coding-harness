import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  writePrepareArtifacts,
  type IssueDetails,
  type PrepareRunStatus
} from "../src/index.js";

const baseIssue: IssueDetails = {
  issueNumber: 42,
  title: "Add prepare artifact writer",
  body: "Approved issue body",
  url: "https://github.com/example/repo/issues/42",
  state: "open"
};

test("writePrepareArtifacts writes default artifacts under .runs issue directory", async () => {
  await withTempCwd(async (root) => {
    const result = await writePrepareArtifacts({
      issue: baseIssue,
      prompt: "Implement the approved plan exactly.",
      worktreePath: "C:/repos/worktrees/issue-42",
      branchName: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before"
    });

    const expectedRunDirectory = path.join(".runs", "issue-42");
    assert.equal(result.runDirectory, expectedRunDirectory);
    assert.equal(result.promptPath, path.join(expectedRunDirectory, "prompt.md"));
    assert.equal(result.issuePath, path.join(expectedRunDirectory, "issue.json"));
    assert.equal(result.runPath, path.join(expectedRunDirectory, "run.json"));

    assert.equal(
      await readFile(path.join(root, result.promptPath), "utf8"),
      "Implement the approved plan exactly."
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, result.issuePath), "utf8")),
      {
        number: 42,
        title: "Add prepare artifact writer",
        body: "Approved issue body"
      }
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, result.runPath), "utf8")),
      {
        status: "prepared",
        issueURL: "https://github.com/example/repo/issues/42",
        issueTitle: "Add prepare artifact writer",
        issueNumber: 42,
        worktreePath: "C:/repos/worktrees/issue-42",
        branch: "42-add-prepare-artifact-writer",
        beforeHead: "abc123before"
      }
    );
    assert.deepEqual(result.run, {
      status: "prepared",
      issueURL: "https://github.com/example/repo/issues/42",
      issueTitle: "Add prepare artifact writer",
      issueNumber: 42,
      worktreePath: "C:/repos/worktrees/issue-42",
      branch: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before"
    });
  });
});

test("writePrepareArtifacts writes artifacts under a custom runs directory", async () => {
  await withTempCwd(async (root) => {
    const result = await writePrepareArtifacts({
      issue: baseIssue,
      prompt: "custom prompt",
      worktreePath: "/worktrees/issue-42",
      branchName: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before",
      runsDirectory: "custom-runs"
    });

    assert.equal(result.runDirectory, path.join("custom-runs", "issue-42"));
    assert.equal(
      await readFile(path.join(root, "custom-runs", "issue-42", "prompt.md"), "utf8"),
      "custom prompt"
    );
  });
});

test("writePrepareArtifacts creates nested run directories recursively", async () => {
  await withTempCwd(async (root) => {
    const result = await writePrepareArtifacts({
      issue: baseIssue,
      prompt: "prompt",
      worktreePath: "/worktrees/issue-42",
      branchName: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before",
      runsDirectory: path.join("nested", "runs")
    });

    const directoryStats = await stat(path.join(root, result.runDirectory));
    assert.equal(directoryStats.isDirectory(), true);
  });
});

test("writePrepareArtifacts preserves prompt content exactly", async () => {
  await withTempCwd(async (root) => {
    const prompt = "Line one\r\nLine two\n\nFinal line";
    const result = await writePrepareArtifacts({
      issue: baseIssue,
      prompt,
      worktreePath: "/worktrees/issue-42",
      branchName: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before"
    });

    assert.equal(await readFile(path.join(root, result.promptPath), "utf8"), prompt);
  });
});

test("writePrepareArtifacts formats JSON artifacts with two spaces and trailing newline", async () => {
  await withTempCwd(async (root) => {
    const result = await writePrepareArtifacts({
      issue: baseIssue,
      prompt: "prompt",
      worktreePath: "/worktrees/issue-42",
      branchName: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before"
    });

    assert.equal(
      await readFile(path.join(root, result.issuePath), "utf8"),
      '{\n  "number": 42,\n  "title": "Add prepare artifact writer",\n  "body": "Approved issue body"\n}\n'
    );
    assert.equal(
      await readFile(path.join(root, result.runPath), "utf8"),
      '{\n  "status": "prepared",\n  "issueURL": "https://github.com/example/repo/issues/42",\n  "issueTitle": "Add prepare artifact writer",\n  "issueNumber": 42,\n  "worktreePath": "/worktrees/issue-42",\n  "branch": "42-add-prepare-artifact-writer",\n  "beforeHead": "abc123before"\n}\n'
    );
  });
});

test("writePrepareArtifacts initializes run status with approved spelling", async () => {
  await withTempCwd(async () => {
    const result = await writePrepareArtifacts({
      issue: baseIssue,
      prompt: "prompt",
      worktreePath: "/worktrees/issue-42",
      branchName: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before"
    });
    const statuses: PrepareRunStatus[] = [
      "prepared",
      "implementing",
      "needsFeedback",
      "approvedPublishing",
      "publishing",
      "published"
    ];

    assert.equal(result.run.status, "prepared");
    assert.equal(statuses.includes(result.run.status), true);
  });
});

test("writePrepareArtifacts falls back to empty issue body", async () => {
  await withTempCwd(async () => {
    const result = await writePrepareArtifacts({
      issue: { ...baseIssue, body: undefined },
      prompt: "prompt",
      worktreePath: "/worktrees/issue-42",
      branchName: "42-add-prepare-artifact-writer",
      beforeHead: "abc123before"
    });

    assert.deepEqual(result.issue, {
      number: 42,
      title: "Add prepare artifact writer",
      body: ""
    });
  });
});

test("writePrepareArtifacts overwrites existing files deterministically", async () => {
  await withTempCwd(async (root) => {
    const runDirectory = path.join(root, ".runs", "issue-42");
    await writePrepareArtifacts({
      issue: baseIssue,
      prompt: "old prompt",
      worktreePath: "/old/worktree",
      branchName: "old-branch",
      beforeHead: "oldhead"
    });
    await writeFile(path.join(runDirectory, "issue.json"), "stale issue", "utf8");
    await writeFile(path.join(runDirectory, "run.json"), "stale run", "utf8");

    await writePrepareArtifacts({
      issue: {
        ...baseIssue,
        title: "Updated title",
        body: "Updated body"
      },
      prompt: "new prompt",
      worktreePath: "/new/worktree",
      branchName: "new-branch",
      beforeHead: "newhead"
    });

    assert.equal(
      await readFile(path.join(runDirectory, "prompt.md"), "utf8"),
      "new prompt"
    );
    assert.equal(
      await readFile(path.join(runDirectory, "issue.json"), "utf8"),
      '{\n  "number": 42,\n  "title": "Updated title",\n  "body": "Updated body"\n}\n'
    );
    assert.equal(
      await readFile(path.join(runDirectory, "run.json"), "utf8"),
      '{\n  "status": "prepared",\n  "issueURL": "https://github.com/example/repo/issues/42",\n  "issueTitle": "Updated title",\n  "issueNumber": 42,\n  "worktreePath": "/new/worktree",\n  "branch": "new-branch",\n  "beforeHead": "newhead"\n}\n'
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
