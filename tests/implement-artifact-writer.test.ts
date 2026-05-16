import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  updateRunArtifact,
  writeDiffArtifact,
  writeReleaseArtifact,
  writeVerificationArtifact,
  type ImplementorReleaseMetadata
} from "../src/index.js";

const release: ImplementorReleaseMetadata = {
  commit_message: "Add implement artifact writer",
  pull_request: {
    title: "Add implement artifact writer",
    summary: "Writes implementation artifacts for a prepared issue.",
    scope: ["Added implement artifact writer."],
    verification: ["npm test"]
  }
};

const preparedRun = {
  status: "implementing",
  issueURL: "https://github.com/example/repo/issues/57",
  issueTitle: "Add implement artifact writer",
  issueNumber: 57,
  worktreePath: "C:/repos/worktrees/issue-57",
  branch: "57-add-implement-artifact-writer"
};

test("individual implement artifact writers write expected files", async () => {
  await withTempCwd(async (root) => {
    await writeRun(root, ".runs", 57, preparedRun);

    const releaseResult = await writeReleaseArtifact({
      issueNumber: 57,
      release
    });
    const verificationResult = await writeVerificationArtifact({
      issueNumber: 57,
      verificationOutput: "status: failed\r\nkeep raw output"
    });
    const diffResult = await writeDiffArtifact({
      issueNumber: 57,
      diff: "diff --git a/file.ts b/file.ts\r\n"
    });
    const runResult = await updateRunArtifact({
      issueNumber: 57,
      status: "implementing"
    });

    const expectedRunDirectory = path.join(".runs", "issue-57");
    assert.deepEqual(releaseResult, {
      runDirectory: expectedRunDirectory,
      releasePath: path.join(expectedRunDirectory, "release.json"),
      release
    });
    assert.deepEqual(verificationResult, {
      runDirectory: expectedRunDirectory,
      verificationOutputPath: path.join(expectedRunDirectory, "verification.txt")
    });
    assert.deepEqual(diffResult, {
      runDirectory: expectedRunDirectory,
      diffPath: path.join(expectedRunDirectory, "diff.patch")
    });
    assert.equal(runResult.runDirectory, expectedRunDirectory);
    assert.equal(runResult.runPath, path.join(expectedRunDirectory, "run.json"));
    assert.deepEqual(runResult.run, {
      ...preparedRun,
      status: "implementing"
    });
    assert.equal(
      await readFile(path.join(root, releaseResult.releasePath), "utf8"),
      `${JSON.stringify(release, null, 2)}\n`
    );
    assert.equal(
      await readFile(path.join(root, verificationResult.verificationOutputPath), "utf8"),
      "status: failed\r\nkeep raw output"
    );
    assert.equal(
      await readFile(path.join(root, diffResult.diffPath), "utf8"),
      "diff --git a/file.ts b/file.ts\r\n"
    );
    assert.equal(
      await readFile(path.join(root, runResult.runPath), "utf8"),
      `${JSON.stringify({ ...preparedRun, status: "implementing" }, null, 2)}\n`
    );
  });
});

test("individual implement artifact writers support custom runs directories", async () => {
  await withTempCwd(async (root) => {
    await writeRun(root, "custom-runs", 57, preparedRun);

    const releaseResult = await writeReleaseArtifact({
      issueNumber: 57,
      release,
      runsDirectory: "custom-runs"
    });
    const verificationResult = await writeVerificationArtifact({
      issueNumber: 57,
      verificationOutput: "custom verification",
      runsDirectory: "custom-runs"
    });
    const diffResult = await writeDiffArtifact({
      issueNumber: 57,
      diff: "custom diff",
      runsDirectory: "custom-runs"
    });
    const runResult = await updateRunArtifact({
      issueNumber: 57,
      status: "needsFeedback",
      runsDirectory: "custom-runs"
    });

    assert.equal(releaseResult.runDirectory, path.join("custom-runs", "issue-57"));
    assert.equal(verificationResult.runDirectory, path.join("custom-runs", "issue-57"));
    assert.equal(diffResult.runDirectory, path.join("custom-runs", "issue-57"));
    assert.equal(runResult.runDirectory, path.join("custom-runs", "issue-57"));
    assert.equal(
      await readFile(path.join(root, "custom-runs", "issue-57", "release.json"), "utf8"),
      `${JSON.stringify(release, null, 2)}\n`
    );
    assert.equal(
      await readFile(
        path.join(root, "custom-runs", "issue-57", "verification.txt"),
        "utf8"
      ),
      "custom verification"
    );
    assert.equal(
      await readFile(path.join(root, "custom-runs", "issue-57", "diff.patch"), "utf8"),
      "custom diff"
    );
  });
});

test("updateRunArtifact creates nested run directories before requiring run state", async () => {
  await withTempCwd(async (root) => {
    await assert.rejects(
      updateRunArtifact({
        issueNumber: 57,
        status: "implementing",
        runsDirectory: path.join("nested", "runs")
      }),
      /Existing run artifact is required/
    );

    const directoryStats = await stat(path.join(root, "nested", "runs", "issue-57"));
    assert.equal(directoryStats.isDirectory(), true);
  });
});

test("individual text artifact writers preserve output exactly", async () => {
  await withTempCwd(async (root) => {
    const diff = "Line one\r\nLine two\n\nFinal diff line";
    const verificationOutput = "Pass 1\r\nPass 2\n\nFinal output";

    const diffResult = await writeDiffArtifact({
      issueNumber: 57,
      diff
    });
    const verificationResult = await writeVerificationArtifact({
      issueNumber: 57,
      verificationOutput
    });

    assert.equal(
      await readFile(path.join(root, diffResult.diffPath), "utf8"),
      diff
    );
    assert.equal(
      await readFile(path.join(root, verificationResult.verificationOutputPath), "utf8"),
      verificationOutput
    );
  });
});

test("writeReleaseArtifact formats release JSON with two spaces and trailing newline", async () => {
  await withTempCwd(async (root) => {
    const result = await writeReleaseArtifact({
      issueNumber: 57,
      release
    });

    assert.equal(
      await readFile(path.join(root, result.releasePath), "utf8"),
      `${JSON.stringify(release, null, 2)}\n`
    );
  });
});

test("updateRunArtifact updates run status and preserves existing run fields", async () => {
  await withTempCwd(async (root) => {
    await writeRun(root, ".runs", 57, {
      ...preparedRun,
      reviewer: "main-agent",
      nested: { keep: true }
    });

    const result = await updateRunArtifact({
      issueNumber: 57,
      status: "needsFeedback"
    });

    assert.deepEqual(result.run, {
      ...preparedRun,
      reviewer: "main-agent",
      nested: { keep: true },
      status: "needsFeedback"
    });
    assert.equal(
      await readFile(path.join(root, result.runPath), "utf8"),
      `${JSON.stringify(result.run, null, 2)}\n`
    );
  });
});

test("updateRunArtifact rejects invalid run.json without changing it", async () => {
  await withTempCwd(async (root) => {
    await writeRunText(root, ".runs", 57, "{not json");

    await assert.rejects(
      updateRunArtifact({
        issueNumber: 57,
        status: "needsFeedback"
      }),
      /must be valid JSON/
    );

    assert.equal(
      await readFile(path.join(root, ".runs", "issue-57", "run.json"), "utf8"),
      "{not json"
    );
  });
});

test("updateRunArtifact rejects non-object run.json without changing it", async () => {
  await withTempCwd(async (root) => {
    await writeRunText(root, ".runs", 57, "[]");

    await assert.rejects(
      updateRunArtifact({
        issueNumber: 57,
        status: "needsFeedback"
      }),
      /must be a JSON object/
    );

    assert.equal(
      await readFile(path.join(root, ".runs", "issue-57", "run.json"), "utf8"),
      "[]"
    );
  });
});

async function writeRun(
  root: string,
  runsDirectory: string,
  issueNumber: number,
  run: unknown
): Promise<void> {
  await writeRunText(root, runsDirectory, issueNumber, `${JSON.stringify(run, null, 2)}\n`);
}

async function writeRunText(
  root: string,
  runsDirectory: string,
  issueNumber: number,
  contents: string
): Promise<void> {
  const runDirectory = path.join(root, runsDirectory, `issue-${issueNumber}`);
  await mkdir(runDirectory, { recursive: true });
  await writeFile(path.join(runDirectory, "run.json"), contents, "utf8");
}

async function withTempCwd(
  callback: (root: string) => Promise<void>
): Promise<void> {
  const originalCwd = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), "implement-artifact-writer-"));

  process.chdir(root);
  try {
    await callback(root);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
}
