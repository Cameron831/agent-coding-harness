import { readFile } from "node:fs/promises";

export interface ImplementorReleaseMetadata {
  commit_message: string;
  pull_request: ImplementorReleasePullRequestMetadata;
}

export interface ImplementorReleasePullRequestMetadata {
  title: string;
  summary: string;
  scope: string[];
  verification: string[];
}

export interface ReleaseValidationError {
  field?: string;
  message: string;
}

export type ReleaseJsonResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      errors: ReleaseValidationError[];
    };

export interface RenderedReleasePullRequestInput {
  title: string;
  body: string;
}

type UnknownRecord = Record<string, unknown>;
type ReleaseField =
  | "commit_message"
  | "pull_request"
  | "pull_request.title"
  | "pull_request.summary"
  | "pull_request.scope"
  | "pull_request.verification";

export async function loadReleaseJson(
  path: string
): Promise<ReleaseJsonResult<ImplementorReleaseMetadata>> {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return failure({
      message: `Failed to read release metadata from ${path}.`
    });
  }

  return parseReleaseJson(contents);
}

export function parseReleaseJson(
  contents: string
): ReleaseJsonResult<ImplementorReleaseMetadata> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return failure({
      message: "Release metadata must be valid JSON."
    });
  }

  if (!isRecord(parsed)) {
    return failure({
      message: "Release metadata must be a JSON object."
    });
  }

  return validateReleaseMetadata(parsed);
}

export function renderReleasePullRequestInput(
  release: ImplementorReleaseMetadata
): RenderedReleasePullRequestInput {
  return {
    title: release.pull_request.title,
    body: renderReleasePullRequestBody(release)
  };
}

export function renderReleasePullRequestBody(
  release: ImplementorReleaseMetadata
): string {
  return [
    "## Summary",
    "",
    release.pull_request.summary.trim(),
    "",
    "## Scope",
    "",
    renderMarkdownList(release.pull_request.scope),
    "",
    "## Verification",
    "",
    renderMarkdownList(release.pull_request.verification)
  ].join("\n");
}

function validateReleaseMetadata(
  release: UnknownRecord
): ReleaseJsonResult<ImplementorReleaseMetadata> {
  const errors: ReleaseValidationError[] = [];
  const commitMessage = validateRequiredString(release, "commit_message");
  const pullRequest = validatePullRequest(release);

  collectErrors(errors, commitMessage, pullRequest);

  if (!commitMessage.ok || !pullRequest.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      commit_message: commitMessage.value,
      pull_request: pullRequest.value
    }
  };
}

function validatePullRequest(
  release: UnknownRecord
): ReleaseJsonResult<ImplementorReleasePullRequestMetadata> {
  if (!("pull_request" in release)) {
    return fieldFailure("pull_request", "is required");
  }

  const value = release.pull_request;
  if (!isRecord(value)) {
    return fieldFailure("pull_request", "must be an object");
  }

  const errors: ReleaseValidationError[] = [];
  const title = validateRequiredString(value, "pull_request.title");
  const summary = validateRequiredString(value, "pull_request.summary");
  const scope = validateRequiredStringArray(value, "pull_request.scope");
  const verification = validateRequiredStringArray(
    value,
    "pull_request.verification"
  );

  collectErrors(errors, title, summary, scope, verification);

  if (!title.ok || !summary.ok || !scope.ok || !verification.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title: title.value,
      summary: summary.value,
      scope: scope.value,
      verification: verification.value
    }
  };
}

function collectErrors(
  errors: ReleaseValidationError[],
  ...results: readonly ReleaseJsonResult<unknown>[]
): void {
  for (const result of results) {
    if (!result.ok) {
      errors.push(...result.errors);
    }
  }
}

function validateRequiredString(
  record: UnknownRecord,
  field: ReleaseField
): ReleaseJsonResult<string> {
  const key = fieldKey(field);
  if (!(key in record)) {
    return fieldFailure(field, "is required");
  }

  const value = record[key];
  if (typeof value !== "string") {
    return fieldFailure(field, "must be a string");
  }

  if (value.trim() === "") {
    return fieldFailure(field, "must be a non-empty string");
  }

  return { ok: true, value };
}

function validateRequiredStringArray(
  record: UnknownRecord,
  field: ReleaseField
): ReleaseJsonResult<string[]> {
  const key = fieldKey(field);
  if (!(key in record)) {
    return fieldFailure(field, "is required");
  }

  const value = record[key];
  if (!Array.isArray(value)) {
    return fieldFailure(field, "must be an array of strings");
  }

  if (value.length === 0) {
    return fieldFailure(field, "must include at least one item");
  }

  const errors: ReleaseValidationError[] = [];
  const strings: string[] = [];

  value.forEach((item, itemIndex) => {
    const itemField = `${field}[${itemIndex}]`;
    if (typeof item !== "string") {
      errors.push({
        field: itemField,
        message: `Release metadata field ${itemField} must be a string.`
      });
      return;
    }

    if (item.trim() === "") {
      errors.push({
        field: itemField,
        message: `Release metadata field ${itemField} must be a non-empty string.`
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
  field: ReleaseField,
  reason: string
): ReleaseJsonResult<T> {
  return failure({
    field,
    message: `Release metadata field ${field} ${reason}.`
  });
}

function fieldKey(field: ReleaseField): string {
  return field.split(".").at(-1) ?? field;
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

function failure<T>(error: ReleaseValidationError): ReleaseJsonResult<T> {
  return { ok: false, errors: [error] };
}
