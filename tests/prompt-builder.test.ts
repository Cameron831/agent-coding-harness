import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  renderPreparePrompt,
  type IssueDetails,
  type PreparePromptVariant
} from "../src/index.js";

const baseIssue: IssueDetails = {
  issueNumber: 43,
  title: "Add prepare prompt builder",
  body: "Render implement prompts from issue details.",
  url: "https://github.com/example/repo/issues/43",
  state: "open"
};

test("renderPreparePrompt defaults to the standard implement prompt", async () => {
  const prompt = await renderPreparePrompt({ issue: baseIssue });

  assert.match(prompt, /GitHub issue #43/);
  assert.match(prompt, /Add prepare prompt builder/);
  assert.match(prompt, /Render implement prompts from issue details\./);
  assert.match(prompt, /Do not use subagents\./);
  assert.match(prompt, /"commit_message"/);
  assert.match(prompt, /"pull_request"/);
  assert.doesNotMatch(prompt, /commitMessage|pullRequest/);
  assert.doesNotMatch(prompt, /\{\{number\}\}|\{\{title\}\}|\{\{body\}\}/);
});

test("renderPreparePrompt selects the with-subagents implement prompt", async () => {
  const prompt = await renderPreparePrompt({
    issue: baseIssue,
    variant: "with-subagents"
  });

  assert.match(prompt, /Use the `exec-planner` subagent/);
  assert.match(prompt, /Use the `executor` subagent/);
  assert.match(prompt, /"commit_message"/);
  assert.match(prompt, /"pull_request"/);
  assert.doesNotMatch(prompt, /commitMessage|pullRequest/);
});

test("implement prompt templates request snake_case release metadata", async () => {
  const promptFiles = [
    "implement-prompt.md",
    "implement-with-subagents-prompt.md",
    "implement-feeback-prompt.md"
  ];

  for (const promptFile of promptFiles) {
    const prompt = await readFile(
      join("prompts", "implement", promptFile),
      "utf8"
    );

    assert.match(prompt, /commit_message/);
    assert.match(prompt, /pull_request/);
    assert.doesNotMatch(prompt, /commitMessage|pullRequest/);
  }
});

test("renderPreparePrompt replaces supported placeholders and leaves unsupported placeholders unchanged", async () => {
  await withCustomPrompts(
    {
      "implement-prompt.md":
        "Issue #{{number}}\nTitle: {{title}}\nBody: {{body}}\nAgain: {{title}}\nOther: {{unknown}}",
      "implement-with-subagents-prompt.md": "unused"
    },
    async (promptsDirectory) => {
      const prompt = await renderPreparePrompt({
        issue: baseIssue,
        promptsDirectory
      });

      assert.equal(
        prompt,
        "Issue #43\nTitle: Add prepare prompt builder\nBody: Render implement prompts from issue details.\nAgain: Add prepare prompt builder\nOther: {{unknown}}"
      );
    }
  );
});

test("renderPreparePrompt renders a missing issue body as an empty string", async () => {
  await withCustomPrompts(
    {
      "implement-prompt.md": "Body begins>{{body}}<Body ends",
      "implement-with-subagents-prompt.md": "unused"
    },
    async (promptsDirectory) => {
      const prompt = await renderPreparePrompt({
        issue: { ...baseIssue, body: undefined },
        promptsDirectory
      });

      assert.equal(prompt, "Body begins><Body ends");
    }
  );
});

test("renderPreparePrompt uses a supplied custom prompts directory", async () => {
  await withCustomPrompts(
    {
      "implement-prompt.md": "custom standard {{number}}",
      "implement-with-subagents-prompt.md": "custom subagents {{title}}"
    },
    async (promptsDirectory) => {
      const variant: PreparePromptVariant = "with-subagents";
      const prompt = await renderPreparePrompt({
        issue: baseIssue,
        variant,
        promptsDirectory
      });

      assert.equal(prompt, "custom subagents Add prepare prompt builder");
    }
  );
});

test("renderPreparePrompt returns a string without writing prepare artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-builder-boundary-"));
  const originalCwd = process.cwd();

  try {
    const promptsDirectory = join(root, "prompts");
    await mkdir(promptsDirectory, { recursive: true });
    await writeFile(
      join(promptsDirectory, "implement-prompt.md"),
      "prompt {{number}}",
      "utf8"
    );
    await writeFile(
      join(promptsDirectory, "implement-with-subagents-prompt.md"),
      "subagents {{number}}",
      "utf8"
    );

    process.chdir(root);
    const prompt = await renderPreparePrompt({
      issue: baseIssue,
      promptsDirectory
    });

    assert.equal(prompt, "prompt 43");
    assert.equal(typeof prompt, "string");
    assert.equal(await exists(join(root, ".runs")), false);
    assert.equal(await exists(join(root, "prompt.md")), false);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

async function withCustomPrompts(
  templates: Record<string, string>,
  callback: (promptsDirectory: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "prompt-builder-"));
  const promptsDirectory = join(root, "prompts");

  try {
    await mkdir(promptsDirectory, { recursive: true });
    for (const [fileName, content] of Object.entries(templates)) {
      await writeFile(join(promptsDirectory, fileName), content, "utf8");
    }

    await callback(promptsDirectory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
