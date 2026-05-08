import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  writeImplementArtifacts,
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

test("writeImplementArtifacts writes default artifacts under .runs issue directory", async () => {
  await withTempCwd(async (root) => {
    await writeRun(root, ".runs", 57, preparedRun);

    const result = await writeImplementArtifacts({
      issueNumber: 57,
      diff: "diff --git a/file.ts b/file.ts\n",
      verificationOutput: "node --test passed\n",
      release
    });

    const expectedRunDirectory = path.join(".runs", "issue-57");
    assert.equal(result.runDirectory, expectedRunDirectory);
    assert.equal(result.diffPath, path.join(expectedRunDirectory, "diff.patch"));
    assert.equal(
      result.verificationOutputPath,
      path.join(expectedRunDirectory, "verification.txt")
    );
    assert.equal(result.releasePath, path.join(expectedRunDirectory, "release.json"));
    assert.equal(result.runPath, path.join(expectedRunDirectory, "run.json"));
    assert.equal(
      await readFile(path.join(root, result.diffPath), "utf8"),
      "diff --git a/file.ts b/file.ts\n"
    );
    assert.equal(
      await readFile(path.join(root, result.verificationOutputPath), "utf8"),
      "node --test passed\n"
    );
    assert.deepEqual(result.release, release);
    assert.deepEqual(result.run, {
      ...preparedRun,
      status: "needsFeedback"
    });
  });
});

test("writeImplementArtifacts writes artifacts under a custom runs directory", async () => {
  await withTempCwd(async (root) => {
    await writeRun(root, "custom-runs", 57, preparedRun);

    const result = await writeImplementArtifacts({
      issueNumber: 57,
      diff: "custom diff",
      verificationOutput: "custom verification",
      release,
      runsDirectory: "custom-runs"
    });

    assert.equal(result.runDirectory, path.join("custom-runs", "issue-57"));
    assert.equal(
      await readFile(path.join(root, "custom-runs", "issue-57", "diff.patch"), "utf8"),
      "custom diff"
    );
  });
});

test("writeImplementArtifacts creates the run directory before requiring run state", async () => {
  await withTempCwd(async (root) => {
    await assert.rejects(
      writeImplementArtifacts({
        issueNumber: 57,
        diff: "diff",
        verificationOutput: "verification",
        release,
        runsDirectory: path.join("nested", "runs")
      }),
      /Existing run artifact is required/
    );

    const directoryStats = await stat(path.join(root, "nested", "runs", "issue-57"));
    assert.equal(directoryStats.isDirectory(), true);
  });
});

test("writeImplementArtifacts preserves diff and verification output exactly", async () => {
  await withTempCwd(async (root) => {
    await writeRun(root, ".runs", 57, preparedRun);
    const diff = "Line one\r\nLine two\n\nFinal diff line";
    const verificationOutput = "Pass 1\r\nPass 2\n\nFinal output";

    const result = await writeImplementArtifacts({
      issueNumber: 57,
      diff,
      verificationOutput,
      release
    });

    assert.equal(await readFile(path.join(root, result.diffPath), "utf8"), diff);
    assert.equal(
      await readFile(path.join(root, result.verificationOutputPath), "utf8"),
      verificationOutput
    );
  });
});

test("writeImplementArtifacts formats release JSON with two spaces and trailing newline", async () => {
  await withTempCwd(async (root) => {
    await writeRun(root, ".runs", 57, preparedRun);

    const result = await writeImplementArtifacts({
      issueNumber: 57,
      diff: "diff",
      verificationOutput: "verification",
      release
    });

    assert.equal(
      await readFile(path.join(root, result.releasePath), "utf8"),
      `${JSON.stringify(release, null, 2)}\n`
    );
  });
});

test("writeImplementArtifacts updates run status and preserves existing run fields", async () => {
  await withTempCwd(async (root) => {
    await writeRun(root, ".runs", 57, {
      ...preparedRun,
      reviewer: "main-agent",
      nested: { keep: true }
    });

    const result = await writeImplementArtifacts({
      issueNumber: 57,
      diff: "diff",
      verificationOutput: "verification",
      release
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

test("writeImplementArtifacts rejects missing run.json before writing artifacts", async () => {
  await withTempCwd(async (root) => {
    await assert.rejects(
      writeImplementArtifacts({
        issueNumber: 57,
        diff: "diff",
        verificationOutput: "verification",
        release
      }),
      /Existing run artifact is required/
    );

    await assert.rejects(readFile(path.join(root, ".runs", "issue-57", "diff.patch")));
    await assert.rejects(readFile(path.join(root, ".runs", "issue-57", "release.json")));
  });
});

test("writeImplementArtifacts rejects invalid run.json before writing artifacts", async () => {
  await withTempCwd(async (root) => {
    await writeRunText(root, ".runs", 57, "{not json");

    await assert.rejects(
      writeImplementArtifacts({
        issueNumber: 57,
        diff: "diff",
        verificationOutput: "verification",
        release
      }),
      /must be valid JSON/
    );

    assert.equal(
      await readFile(path.join(root, ".runs", "issue-57", "run.json"), "utf8"),
      "{not json"
    );
    await assert.rejects(readFile(path.join(root, ".runs", "issue-57", "diff.patch")));
  });
});

test("writeImplementArtifacts rejects non-object run.json before writing artifacts", async () => {
  await withTempCwd(async (root) => {
    await writeRunText(root, ".runs", 57, "[]");

    await assert.rejects(
      writeImplementArtifacts({
        issueNumber: 57,
        diff: "diff",
        verificationOutput: "verification",
        release
      }),
      /must be a JSON object/
    );

    assert.equal(
      await readFile(path.join(root, ".runs", "issue-57", "run.json"), "utf8"),
      "[]"
    );
    await assert.rejects(readFile(path.join(root, ".runs", "issue-57", "release.json")));
  });
});

test("writeImplementArtifacts overwrites existing files deterministically", async () => {
  await withTempCwd(async (root) => {
    await writeRun(root, ".runs", 57, preparedRun);
    await writeImplementArtifacts({
      issueNumber: 57,
      diff: "old diff",
      verificationOutput: "old verification",
      release: {
        ...release,
        commit_message: "Old commit message"
      }
    });
    await writeFile(path.join(root, ".runs", "issue-57", "release.json"), "stale", "utf8");

    const result = await writeImplementArtifacts({
      issueNumber: 57,
      diff: "new diff",
      verificationOutput: "new verification",
      release
    });

    assert.equal(await readFile(path.join(root, result.diffPath), "utf8"), "new diff");
    assert.equal(
      await readFile(path.join(root, result.verificationOutputPath), "utf8"),
      "new verification"
    );
    assert.equal(
      await readFile(path.join(root, result.releasePath), "utf8"),
      `${JSON.stringify(release, null, 2)}\n`
    );
    assert.equal(
      await readFile(path.join(root, result.runPath), "utf8"),
      `${JSON.stringify({ ...preparedRun, status: "needsFeedback" }, null, 2)}\n`
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
