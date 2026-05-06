import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadPlannerPlan,
  parsePlannerPlanJson,
  renderPlannerIssueBody,
  renderPlannerIssueInput
} from "../src/index.js";
import type { PlannerPlanIssueInput } from "../src/index.js";

const validIssue: PlannerPlanIssueInput = {
  title: "Add planner plan parser",
  goal: "Add reusable logic for loading planner issue plans.",
  scope: ["Define issue types.", "Validate raw planner JSON."],
  acceptance_criteria: [
    "Valid artifacts parse without invoking GitHub.",
    "Invalid artifacts fail before mutation."
  ],
  notes: ["Do not add the CLI command yet."]
};

test("loads valid planner plan artifacts into structured issue inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "planner-plan-"));
  const planPath = join(directory, "plan.json");
  await writeFile(planPath, JSON.stringify([validIssue]), "utf8");

  const result = await loadPlannerPlan(planPath);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, [validIssue]);
});

test("invalid JSON returns a validation failure", () => {
  const result = parsePlannerPlanJson("{not valid");

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.errors[0].message : "", /valid JSON/);
});

test("non-array JSON returns a validation failure", () => {
  const result = parsePlannerPlanJson(JSON.stringify({ issues: [validIssue] }));

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.errors[0].message : "", /raw JSON array/);
});

test("missing fields and empty strings identify the issue index and field", () => {
  const result = parsePlannerPlanJson(
    JSON.stringify([
      {
        ...validIssue,
        title: " "
      },
      {
        title: "Missing goal",
        scope: ["Included work."],
        acceptance_criteria: ["Verifiable outcome."],
        notes: ["Important note."]
      }
    ])
  );

  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.errors, [
    {
      issueIndex: 0,
      field: "title",
      message: "Issue 0 field title must be a non-empty string."
    },
    {
      issueIndex: 1,
      field: "goal",
      message: "Issue 1 field goal is required."
    }
  ]);
});

test("malformed issue arrays identify the issue index and field", () => {
  const result = parsePlannerPlanJson(
    JSON.stringify([
      {
        ...validIssue,
        scope: "not an array",
        acceptance_criteria: [],
        notes: ["Valid note.", "", 42]
      }
    ])
  );

  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.errors, [
    {
      issueIndex: 0,
      field: "scope",
      message: "Issue 0 field scope must be an array of strings."
    },
    {
      issueIndex: 0,
      field: "acceptance_criteria",
      message: "Issue 0 field acceptance_criteria must include at least one item."
    },
    {
      issueIndex: 0,
      field: "notes[1]",
      message: "Issue 0 field notes[1] must be a non-empty string."
    },
    {
      issueIndex: 0,
      field: "notes[2]",
      message: "Issue 0 field notes[2] must be a string."
    }
  ]);
});

test("rendered issue bodies preserve structured planner fields", () => {
  const body = renderPlannerIssueBody(validIssue);

  assert.equal(
    body,
    [
      "## Goal",
      "",
      "Add reusable logic for loading planner issue plans.",
      "",
      "## Scope",
      "",
      "- Define issue types.",
      "- Validate raw planner JSON.",
      "",
      "## Acceptance Criteria",
      "",
      "- Valid artifacts parse without invoking GitHub.",
      "- Invalid artifacts fail before mutation.",
      "",
      "## Notes",
      "",
      "- Do not add the CLI command yet."
    ].join("\n")
  );
});

test("rendered issue inputs keep title separate from the Markdown body", () => {
  const rendered = renderPlannerIssueInput(validIssue);

  assert.equal(rendered.title, "Add planner plan parser");
  assert.match(rendered.body, /## Goal/);
  assert.doesNotMatch(rendered.body, /^# Add planner plan parser/);
});
