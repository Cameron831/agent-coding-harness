import assert from "node:assert/strict";
import { access, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildImplementCodexConfig,
  implementReleaseOutputSchema,
  runImplementWorkflow
} from "../src/index.js";
import type {
  ImplementCodexClient,
  ImplementCodexClientOptions,
  ImplementCodexThreadOptions,
  ImplementCodexTurnOptions,
  ImplementorReleaseMetadata
} from "../src/index.js";

const validRelease: ImplementorReleaseMetadata = {
  commit_message: "Add implement workflow",
  pull_request: {
    title: "Add implement workflow",
    summary: "Runs Codex against a prepared prompt and validates release JSON.",
    scope: ["Added implement workflow."],
    verification: ["npm test"]
  }
};

class FakeCodexClient implements ImplementCodexClient {
  readonly startThreadInputs: ImplementCodexThreadOptions[] = [];
  readonly runInputs: Array<{
    input: string;
    options?: ImplementCodexTurnOptions;
  }> = [];

  constructor(private readonly finalResponse: string) {}

  startThread(options?: ImplementCodexThreadOptions) {
    assert.ok(options);
    this.startThreadInputs.push(options);
    return {
      run: async (input: string, options?: ImplementCodexTurnOptions) => {
        this.runInputs.push({ input, options });
        return {
          finalResponse: this.finalResponse
        };
      }
    };
  }
}

test("implement workflow uses injected SDK factory and runs the loaded prompt in the target worktree", async () => {
  const client = new FakeCodexClient(JSON.stringify(validRelease));
  const factoryInputs: ImplementCodexClientOptions[] = [];

  const result = await runImplementWorkflow(
    {
      promptPath: ".runs/issue-54/prompt.md",
      targetWorktreePath: "C:/repos/worktrees/issue-54"
    },
    {
      loadPrompt: async (path) => `prompt from ${path}`,
      createCodexClient: (options) => {
        factoryInputs.push(options);
        return client;
      }
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(factoryInputs, [{ config: buildImplementCodexConfig() }]);
  assert.deepEqual(client.startThreadInputs, [
    { workingDirectory: "C:/repos/worktrees/issue-54" }
  ]);
  assert.deepEqual(client.runInputs, [
    {
      input: "prompt from .runs/issue-54/prompt.md",
      options: { outputSchema: implementReleaseOutputSchema }
    }
  ]);
});

test("implement workflow success returns validated release metadata", async () => {
  const result = await runImplementWorkflow(
    {
      promptPath: "prompt.md",
      targetWorktreePath: "C:/repos/worktrees/issue-54"
    },
    {
      loadPrompt: async () => "prepared prompt",
      codexClient: new FakeCodexClient(JSON.stringify(validRelease))
    }
  );

  assert.deepEqual(result, {
    ok: true,
    value: {
      release: validRelease
    }
  });
});

test("implement workflow reports prompt loading failures before SDK execution", async () => {
  let sdkCreated = false;

  const result = await runImplementWorkflow(
    {
      promptPath: "missing.md",
      targetWorktreePath: "C:/repos/worktrees/issue-54"
    },
    {
      loadPrompt: async () => {
        throw new Error("prompt missing");
      },
      createCodexClient: () => {
        sdkCreated = true;
        return new FakeCodexClient(JSON.stringify(validRelease));
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "prompt_load");
  assert.equal(result.ok || result.error.message, "prompt missing");
  assert.equal(sdkCreated, false);
});

test("implement workflow reports SDK execution failures", async () => {
  const result = await runImplementWorkflow(
    {
      promptPath: "prompt.md",
      targetWorktreePath: "C:/repos/worktrees/issue-54"
    },
    {
      loadPrompt: async () => "prepared prompt",
      codexClient: {
        startThread: () => ({
          run: async () => {
            throw new Error("codex failed");
          }
        })
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "sdk_execution");
  assert.equal(result.ok || result.error.message, "codex failed");
});

test("implement workflow distinguishes invalid JSON from schema validation failures", async () => {
  const invalidJsonResult = await runImplementWorkflow(
    {
      promptPath: "prompt.md",
      targetWorktreePath: "C:/repos/worktrees/issue-54"
    },
    {
      loadPrompt: async () => "prepared prompt",
      codexClient: new FakeCodexClient("{not json")
    }
  );

  assert.equal(invalidJsonResult.ok, false);
  assert.equal(
    invalidJsonResult.ok || invalidJsonResult.error.stage,
    "invalid_json"
  );

  const schemaInvalidResult = await runImplementWorkflow(
    {
      promptPath: "prompt.md",
      targetWorktreePath: "C:/repos/worktrees/issue-54"
    },
    {
      loadPrompt: async () => "prepared prompt",
      codexClient: new FakeCodexClient(
        JSON.stringify({
          commitMessage: "camel case is not approved",
          pullRequest: {
            title: "Wrong shape"
          }
        })
      )
    }
  );

  assert.equal(schemaInvalidResult.ok, false);
  assert.equal(schemaInvalidResult.ok || schemaInvalidResult.error.stage, "validation");
  assert.match(
    schemaInvalidResult.ok
      ? ""
      : schemaInvalidResult.error.errors?.map((error) => error.message).join("\n") ??
          "",
    /commit_message/
  );
  assert.match(
    schemaInvalidResult.ok
      ? ""
      : schemaInvalidResult.error.errors?.map((error) => error.message).join("\n") ??
          "",
    /pull_request/
  );
});

test("implement workflow rejects additional release metadata fields", async () => {
  const result = await runImplementWorkflow(
    {
      promptPath: "prompt.md",
      targetWorktreePath: "C:/repos/worktrees/issue-54"
    },
    {
      loadPrompt: async () => "prepared prompt",
      codexClient: new FakeCodexClient(
        JSON.stringify({
          ...validRelease,
          extra: "not allowed",
          pull_request: {
            ...validRelease.pull_request,
            extra: "not allowed"
          }
        })
      )
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.error.stage, "validation");
  assert.deepEqual(
    result.ok ? [] : result.error.errors?.map((error) => error.field),
    ["pull_request.extra", "extra"]
  );
});

test("implement workflow does not write release or run artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "implement-workflow-"));
  const promptPath = join(directory, "prompt.md");
  await writeFile(promptPath, "prepared prompt", "utf8");

  const result = await runImplementWorkflow(
    {
      promptPath,
      targetWorktreePath: directory
    },
    {
      codexClient: new FakeCodexClient(JSON.stringify(validRelease))
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual((await readdir(directory)).sort(), ["prompt.md"]);
  await assert.rejects(access(join(directory, "release.json")));
  await assert.rejects(access(join(directory, "run.json")));
});
