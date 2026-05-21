import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadReleaseRunArtifact,
  updateRunStatus,
  writeBeforeHeadRunArtifact,
  writePullRequestRunArtifact
} from "../src/index.js";

const approvedRun = {
  status: "approvedPublishing",
  issueURL: "https://github.com/example/repo/issues/69",
  issueTitle: "Add release artifact helpers",
  issueNumber: 69,
  worktreePath: "C:/repos/worktrees/issue-69",
  branch: "69-add-release-artifact-helpers",
  beforeHead: "abc123before"
};

test("loadReleaseRunArtifact rejects missing run.json with a clear failure", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");

    await assert.rejects(
      loadReleaseRunArtifact({ runPath }),
      /Existing release run artifact is required/
    );
  });
});

test("loadReleaseRunArtifact rejects invalid JSON with a clear failure", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");
    await writeFile(runPath, "{not json", "utf8");

    await assert.rejects(
      loadReleaseRunArtifact({ runPath }),
      /must be valid JSON/
    );

    assert.equal(await readFile(runPath, "utf8"), "{not json");
  });
});

test("loadReleaseRunArtifact rejects non-object JSON with a clear failure", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");
    await writeFile(runPath, "[]", "utf8");

    await assert.rejects(
      loadReleaseRunArtifact({ runPath }),
      /must be a JSON object/
    );

    assert.equal(await readFile(runPath, "utf8"), "[]");
  });
});

test("loadReleaseRunArtifact accepts any JSON object", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");
    const run = { reviewer: "main-agent" };
    await writeJson(runPath, run);

    assert.deepEqual(await loadReleaseRunArtifact({ runPath }), run);
  });
});

test("updateRunStatus writes the caller status, preserves unrelated fields, and writes deterministic JSON", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");
    const run = {
      reviewer: "main-agent",
      nested: { keep: true }
    };
    await writeJson(runPath, run);

    const result = await updateRunStatus({ runPath, status: "custom-status" });

    assert.deepEqual(result.run, {
      ...run,
      status: "custom-status"
    });
    assert.equal(
      await readFile(runPath, "utf8"),
      `${JSON.stringify(result.run, null, 2)}\n`
    );
  });
});

test("writePullRequestRunArtifact writes PR URL and preserves status and unrelated fields", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");
    const run = {
      ...approvedRun,
      status: "publishing",
      reviewer: "main-agent",
      nested: { keep: true }
    };
    await writeJson(runPath, run);

    const result = await writePullRequestRunArtifact({
      runPath,
      pullRequestURL: "https://github.com/example/repo/pull/70"
    });

    assert.deepEqual(result.run, {
      ...run,
      pullRequestURL: "https://github.com/example/repo/pull/70"
    });
    assert.equal(
      await readFile(runPath, "utf8"),
      `${JSON.stringify(result.run, null, 2)}\n`
    );
  });
});

test("writePullRequestRunArtifact can persist a PR URL on any JSON object", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");
    await writeJson(runPath, {
      reviewer: "main-agent"
    });

    const result = await writePullRequestRunArtifact({
      runPath,
      pullRequestURL: "https://github.com/example/repo/pull/70"
    });

    assert.deepEqual(result.run, {
      reviewer: "main-agent",
      pullRequestURL: "https://github.com/example/repo/pull/70"
    });

    const contents = await readFile(runPath, "utf8");
    const persisted = JSON.parse(contents) as Record<string, unknown>;
    assert.equal(persisted.pullRequestURL, "https://github.com/example/repo/pull/70");
    assert.equal(contents, `${JSON.stringify(result.run, null, 2)}\n`);
  });
});

test("writeBeforeHeadRunArtifact writes beforeHead and preserves unrelated fields", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");
    const run = {
      ...approvedRun,
      status: "publishing",
      reviewer: "main-agent",
      nested: { keep: true }
    };
    await writeJson(runPath, run);

    const result = await writeBeforeHeadRunArtifact({
      runPath,
      beforeHead: "def456release"
    });

    assert.deepEqual(result.run, {
      ...run,
      beforeHead: "def456release"
    });
    assert.equal(
      await readFile(runPath, "utf8"),
      `${JSON.stringify(result.run, null, 2)}\n`
    );
  });
});

test("writeBeforeHeadRunArtifact rejects invalid beforeHead before mutation", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");
    await writeJson(runPath, approvedRun);

    for (const beforeHead of [" ", undefined]) {
      await assert.rejects(
        writeBeforeHeadRunArtifact({
          runPath,
          beforeHead: beforeHead as string
        }),
        /beforeHead must be a non-empty string/
      );
    }

    assert.equal(
      await readFile(runPath, "utf8"),
      `${JSON.stringify(approvedRun, null, 2)}\n`
    );
  });
});

test("writePullRequestRunArtifact rejects blank PR URLs before mutation", async () => {
  await withTempCwd(async (root) => {
    const runPath = path.join(root, "run.json");
    await writeJson(runPath, approvedRun);

    await assert.rejects(
      writePullRequestRunArtifact({
        runPath,
        pullRequestURL: " "
      }),
      /pullRequestURL must be a non-empty string/
    );

    assert.equal(
      await readFile(runPath, "utf8"),
      `${JSON.stringify(approvedRun, null, 2)}\n`
    );
  });
});

test("release artifact writers reject invalid artifacts before mutation", async () => {
  const cases = [
    {
      name: "updateRunStatus",
      write: (runPath: string) => updateRunStatus({ runPath, status: "publishing" })
    },
    {
      name: "writePullRequestRunArtifact",
      write: (runPath: string) =>
        writePullRequestRunArtifact({
          runPath,
          pullRequestURL: "https://github.com/example/repo/pull/70"
        })
    },
    {
      name: "writeBeforeHeadRunArtifact",
      write: (runPath: string) =>
        writeBeforeHeadRunArtifact({
          runPath,
          beforeHead: "def456release"
        })
    }
  ];

  for (const writeCase of cases) {
    await withTempCwd(async (root) => {
      const missingRunPath = path.join(root, `${writeCase.name}-missing.json`);
      await assert.rejects(
        writeCase.write(missingRunPath),
        /Existing release run artifact is required/
      );

      const invalidRunPath = path.join(root, `${writeCase.name}-invalid.json`);
      await writeFile(invalidRunPath, "{not json", "utf8");
      await assert.rejects(writeCase.write(invalidRunPath), /must be valid JSON/);
      assert.equal(await readFile(invalidRunPath, "utf8"), "{not json");

      const nonObjectRunPath = path.join(root, `${writeCase.name}-array.json`);
      await writeFile(nonObjectRunPath, "[]", "utf8");
      await assert.rejects(writeCase.write(nonObjectRunPath), /must be a JSON object/);
      assert.equal(await readFile(nonObjectRunPath, "utf8"), "[]");
    });
  }
});

async function writeJson(pathToWrite: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(pathToWrite), { recursive: true });
  await writeFile(pathToWrite, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function withTempCwd(
  callback: (root: string) => Promise<void>
): Promise<void> {
  const originalCwd = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), "release-artifact-writer-"));

  process.chdir(root);
  try {
    await callback(root);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
}
