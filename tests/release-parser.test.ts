import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadReleaseJson,
  parseReleaseJson,
  renderReleasePullRequestBody,
  renderReleasePullRequestInput
} from "../src/index.js";
import type { ImplementorReleaseMetadata } from "../src/index.js";

const validRelease: ImplementorReleaseMetadata = {
  commit_message: "Add release metadata parser",
  pull_request: {
    title: "Add release metadata parsing",
    summary: "Adds validated parsing for implementor release metadata.",
    scope: ["Define release metadata types.", "Validate release JSON."],
    verification: ["npm test"]
  }
};

test("loads valid release metadata into structured release input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-json-"));
  const releasePath = join(directory, "release.json");
  await writeFile(releasePath, JSON.stringify(validRelease), "utf8");

  const result = await loadReleaseJson(releasePath);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, validRelease);
});

test("invalid JSON returns a validation failure", () => {
  const result = parseReleaseJson("{not valid");

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.errors[0].message : "", /valid JSON/);
});

test("non-object JSON returns a validation failure", () => {
  const result = parseReleaseJson(JSON.stringify([validRelease]));

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.errors[0].message : "", /JSON object/);
});

test("missing fields and empty strings identify the release field", () => {
  const result = parseReleaseJson(
    JSON.stringify({
      commit_message: " ",
      pull_request: {
        title: "Add release parser",
        scope: ["Included work."],
        verification: ["npm test"]
      }
    })
  );

  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.errors, [
    {
      field: "commit_message",
      message:
        "Release metadata field commit_message must be a non-empty string."
    },
    {
      field: "pull_request.summary",
      message: "Release metadata field pull_request.summary is required."
    }
  ]);
});

test("malformed pull request fields identify the release field", () => {
  const result = parseReleaseJson(
    JSON.stringify({
      commit_message: "Add release parser",
      pull_request: {
        title: 42,
        summary: "Adds release parser support.",
        scope: "not an array",
        verification: ["npm test", "", false]
      }
    })
  );

  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.errors, [
    {
      field: "pull_request.title",
      message: "Release metadata field pull_request.title must be a string."
    },
    {
      field: "pull_request.scope",
      message:
        "Release metadata field pull_request.scope must be an array of strings."
    },
    {
      field: "pull_request.verification[1]",
      message:
        "Release metadata field pull_request.verification[1] must be a non-empty string."
    },
    {
      field: "pull_request.verification[2]",
      message:
        "Release metadata field pull_request.verification[2] must be a string."
    }
  ]);
});

test("empty pull request arrays identify the release field", () => {
  const result = parseReleaseJson(
    JSON.stringify({
      commit_message: "Add release parser",
      pull_request: {
        title: "Add release parser",
        summary: "Adds release parser support.",
        scope: [],
        verification: []
      }
    })
  );

  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.errors, [
    {
      field: "pull_request.scope",
      message:
        "Release metadata field pull_request.scope must include at least one item."
    },
    {
      field: "pull_request.verification",
      message:
        "Release metadata field pull_request.verification must include at least one item."
    }
  ]);
});

test("missing pull request object returns a validation failure", () => {
  const result = parseReleaseJson(
    JSON.stringify({
      commit_message: "Add release parser"
    })
  );

  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.errors, [
    {
      field: "pull_request",
      message: "Release metadata field pull_request is required."
    }
  ]);
});

test("rendered pull request bodies preserve release metadata sections", () => {
  const body = renderReleasePullRequestBody(validRelease);

  assert.equal(
    body,
    [
      "## Summary",
      "",
      "Adds validated parsing for implementor release metadata.",
      "",
      "## Scope",
      "",
      "- Define release metadata types.",
      "- Validate release JSON.",
      "",
      "## Verification",
      "",
      "- npm test"
    ].join("\n")
  );
});

test("rendered pull request inputs keep title separate from the Markdown body", () => {
  const rendered = renderReleasePullRequestInput(validRelease);

  assert.deepEqual(rendered, {
    title: "Add release metadata parsing",
    body: renderReleasePullRequestBody(validRelease)
  });
  assert.doesNotMatch(rendered.body, /^# Add release metadata parsing/);
});
