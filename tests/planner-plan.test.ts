import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  generatePlannerIssueIdempotencyKey,
  loadPlannerPlan,
  parsePlannerPlanJson,
  renderPlannerIssueBody,
  renderPlannerIssueIdempotencyMarker,
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

test("planner issue idempotency keys are stable for the same content and index", () => {
  const firstKey = generatePlannerIssueIdempotencyKey(validIssue, 0);
  const secondKey = generatePlannerIssueIdempotencyKey({ ...validIssue }, 0);

  assert.equal(firstKey, secondKey);
  assert.match(firstKey, /^[a-f0-9]{64}$/);
});

test("planner issue idempotency keys change when issue content changes", () => {
  const baseKey = generatePlannerIssueIdempotencyKey(validIssue, 0);
  const changedIssues: PlannerPlanIssueInput[] = [
    { ...validIssue, title: "Add a different parser" },
    { ...validIssue, goal: "Load planner issue plans from another source." },
    { ...validIssue, scope: ["Define issue types.", "Validate more inputs."] },
    {
      ...validIssue,
      acceptance_criteria: [
        "Valid artifacts parse without invoking GitHub.",
        "Generated keys are reported."
      ]
    },
    { ...validIssue, notes: ["Keep the CLI command out of scope."] }
  ];

  for (const issue of changedIssues) {
    assert.notEqual(generatePlannerIssueIdempotencyKey(issue, 0), baseKey);
  }
});

test("planner issue idempotency keys differ by plan index", () => {
  assert.notEqual(
    generatePlannerIssueIdempotencyKey(validIssue, 0),
    generatePlannerIssueIdempotencyKey(validIssue, 1)
  );
});

test("rendered issue bodies include idempotency markers without changing visible sections", () => {
  const markedBody = renderPlannerIssueBody(validIssue, { planIndex: 0 });
  const marker = renderPlannerIssueIdempotencyMarker(
    generatePlannerIssueIdempotencyKey(validIssue, 0)
  );

  assert.equal(markedBody.split("\n").at(0), marker);
  assert.equal(markedBody.slice(marker.length + 2), renderPlannerIssueBody(validIssue));
});

test("rendered issue inputs keep title separate from the Markdown body", () => {
  const rendered = renderPlannerIssueInput(validIssue);

  assert.equal(rendered.title, "Add planner plan parser");
  assert.match(rendered.body, /## Goal/);
  assert.doesNotMatch(rendered.body, /^# Add planner plan parser/);
});
