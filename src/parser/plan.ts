import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface PlannerPlanIssueInput {
  title: string;
  goal: string;
  scope: string[];
  acceptance_criteria: string[];
  notes: string[];
}

export interface RenderedPlannerIssueInput {
  title: string;
  body: string;
}

export interface PlannerIssueRenderOptions {
  planIndex?: number;
}

export interface PlannerPlanValidationError {
  issueIndex?: number;
  field?: string;
  message: string;
}

export type PlannerPlanResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      errors: PlannerPlanValidationError[];
    };

type PlannerPlanIssueField = keyof PlannerPlanIssueInput;

type UnknownRecord = Record<string, unknown>;

export async function loadPlannerPlan(
  path: string
): Promise<PlannerPlanResult<PlannerPlanIssueInput[]>> {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return failure({
      message: `Failed to read planner plan from ${path}.`
    });
  }

  return parsePlannerPlanJson(contents);
}

export function parsePlannerPlanJson(
  contents: string
): PlannerPlanResult<PlannerPlanIssueInput[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return failure({
      message: "Planner plan must be valid JSON."
    });
  }

  if (!Array.isArray(parsed)) {
    return failure({
      message: "Planner plan must be a raw JSON array of issue objects."
    });
  }

  const errors: PlannerPlanValidationError[] = [];
  const issues: PlannerPlanIssueInput[] = [];

  parsed.forEach((issue, issueIndex) => {
    const validated = validatePlannerPlanIssue(issue, issueIndex);
    if (validated.ok) {
      issues.push(validated.value);
    } else {
      errors.push(...validated.errors);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: issues };
}

export function renderPlannerIssueInput(
  issue: PlannerPlanIssueInput,
  options: PlannerIssueRenderOptions = {}
): RenderedPlannerIssueInput {
  return {
    title: issue.title,
    body: renderPlannerIssueBody(issue, options)
  };
}

export function renderPlannerIssueBody(
  issue: PlannerPlanIssueInput,
  options: PlannerIssueRenderOptions = {}
): string {
  const body = [
    "## Goal",
    "",
    issue.goal.trim(),
    "",
    "## Scope",
    "",
    renderMarkdownList(issue.scope),
    "",
    "## Acceptance Criteria",
    "",
    renderMarkdownList(issue.acceptance_criteria),
    "",
    "## Notes",
    "",
    renderMarkdownList(issue.notes)
  ].join("\n");

  if (options.planIndex === undefined) {
    return body;
  }

  return [
    renderPlannerIssueIdempotencyMarker(
      generatePlannerIssueIdempotencyKey(issue, options.planIndex)
    ),
    "",
    body
  ].join("\n");
}

export function generatePlannerIssueIdempotencyKey(
  issue: PlannerPlanIssueInput,
  planIndex: number
): string {
  const payload = JSON.stringify({
    marker: "planner-issue-idempotency-v1",
    planIndex,
    issue: {
      title: issue.title,
      goal: issue.goal,
      scope: issue.scope,
      acceptance_criteria: issue.acceptance_criteria,
      notes: issue.notes
    }
  });

  return createHash("sha256").update(payload).digest("hex");
}

export function renderPlannerIssueIdempotencyMarker(key: string): string {
  return `<!-- planner-issue-idempotency-key: ${key} -->`;
}

function validatePlannerPlanIssue(
  issue: unknown,
  issueIndex: number
): PlannerPlanResult<PlannerPlanIssueInput> {
  if (!isRecord(issue)) {
    return failure({
      issueIndex,
      message: `Issue at index ${issueIndex} must be an object.`
    });
  }

  const errors: PlannerPlanValidationError[] = [];
  const title = validateRequiredString(issue, issueIndex, "title");
  const goal = validateRequiredString(issue, issueIndex, "goal");
  const scope = validateRequiredStringArray(issue, issueIndex, "scope");
  const acceptanceCriteria = validateRequiredStringArray(
    issue,
    issueIndex,
    "acceptance_criteria"
  );
  const notes = validateRequiredStringArray(issue, issueIndex, "notes");

  collectErrors(errors, title, goal, scope, acceptanceCriteria, notes);

  if (
    !title.ok ||
    !goal.ok ||
    !scope.ok ||
    !acceptanceCriteria.ok ||
    !notes.ok
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title: title.value,
      goal: goal.value,
      scope: scope.value,
      acceptance_criteria: acceptanceCriteria.value,
      notes: notes.value
    }
  };
}

function collectErrors(
  errors: PlannerPlanValidationError[],
  ...results: readonly PlannerPlanResult<unknown>[]
): void {
  for (const result of results) {
    if (!result.ok) {
      errors.push(...result.errors);
    }
  }
}

function validateRequiredString(
  issue: UnknownRecord,
  issueIndex: number,
  field: PlannerPlanIssueField
): PlannerPlanResult<string> {
  if (!(field in issue)) {
    return fieldFailure(issueIndex, field, "is required");
  }

  const value = issue[field];
  if (typeof value !== "string") {
    return fieldFailure(issueIndex, field, "must be a string");
  }

  if (value.trim() === "") {
    return fieldFailure(issueIndex, field, "must be a non-empty string");
  }

  return { ok: true, value };
}

function validateRequiredStringArray(
  issue: UnknownRecord,
  issueIndex: number,
  field: PlannerPlanIssueField
): PlannerPlanResult<string[]> {
  if (!(field in issue)) {
    return fieldFailure(issueIndex, field, "is required");
  }

  const value = issue[field];
  if (!Array.isArray(value)) {
    return fieldFailure(issueIndex, field, "must be an array of strings");
  }

  if (value.length === 0) {
    return fieldFailure(issueIndex, field, "must include at least one item");
  }

  const errors: PlannerPlanValidationError[] = [];
  const strings: string[] = [];

  value.forEach((item, itemIndex) => {
    const itemField = `${field}[${itemIndex}]`;
    if (typeof item !== "string") {
      errors.push({
        issueIndex,
        field: itemField,
        message: `Issue ${issueIndex} field ${itemField} must be a string.`
      });
      return;
    }

    if (item.trim() === "") {
      errors.push({
        issueIndex,
        field: itemField,
        message: `Issue ${issueIndex} field ${itemField} must be a non-empty string.`
      });
      return;
    }

    strings.push(item);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: strings };
}

function fieldFailure<T>(
  issueIndex: number,
  field: PlannerPlanIssueField,
  reason: string
): PlannerPlanResult<T> {
  return failure({
    issueIndex,
    field,
    message: `Issue ${issueIndex} field ${field} ${reason}.`
  });
}

function renderMarkdownList(items: readonly string[]): string {
  return items.map(renderMarkdownListItem).join("\n");
}

function renderMarkdownListItem(item: string): string {
  const [firstLine = "", ...remainingLines] = item.trim().split(/\r?\n/);
  return [
    `- ${firstLine}`,
    ...remainingLines.map((line) => `  ${line}`)
  ].join("\n");
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure<T>(error: PlannerPlanValidationError): PlannerPlanResult<T> {
  return { ok: false, errors: [error] };
}
