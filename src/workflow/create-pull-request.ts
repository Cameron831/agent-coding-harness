import {
  loadReleaseJson,
  renderReleasePullRequestInput,
  type ImplementorReleaseMetadata,
  type ReleaseJsonResult,
  type ReleaseValidationError
} from "../parser/release.js";
import { GhGitHubAutomationClient } from "../github/gh-client.js";
import type { GitHubAutomationClient } from "../github/client.js";
import type {
  CreatePullRequestInput,
  PullRequestDetails,
  RepositorySelection
} from "../github/types.js";

export interface ReleasePullRequestWorkflowOptions {
  releasePath: string;
  repository?: RepositorySelection;
  base: string;
  head?: string;
  dryRun: boolean;
}

export type BranchResolutionResult =
  | {
      ok: true;
      branchName: string;
    }
  | {
      ok: false;
      message: string;
    };

export interface ReleasePullRequestWorkflowDependencies {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  loadRelease?: (
    path: string
  ) => Promise<ReleaseJsonResult<ImplementorReleaseMetadata>>;
  resolveCurrentBranch?: () => Promise<BranchResolutionResult>;
  githubClient?: GitHubAutomationClient;
  createGitHubClient?: () => GitHubAutomationClient;
}

export async function runReleasePullRequestWorkflow(
  options: ReleasePullRequestWorkflowOptions,
  dependencies: ReleasePullRequestWorkflowDependencies = {}
): Promise<number> {
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;
  const loadRelease = dependencies.loadRelease ?? loadReleaseJson;

  const release = await loadRelease(options.releasePath);
  if (!release.ok) {
    stderr(formatReleaseValidationErrors(release.errors));
    return 1;
  }

  const rendered = renderReleasePullRequestInput(release.value);
  const head = await resolvePullRequestHead(options, dependencies.resolveCurrentBranch);
  if (!head.ok) {
    stderr(formatBranchResolutionFailure(head.message));
    return 1;
  }

  const input = toCreatePullRequestInput(options, rendered, head.branchName);

  if (options.dryRun) {
    stdout(formatPullRequestDryRunOutput(input));
    return 0;
  }

  const client =
    dependencies.githubClient ??
    dependencies.createGitHubClient?.() ??
    new GhGitHubAutomationClient();
  const result = await client.createPullRequest(input);

  if (!result.ok) {
    stderr(formatPullRequestCreationFailure(input.title, result.error.message));
    return 1;
  }

  stdout(formatPullRequestCreationSuccess(result.value));
  return 0;
}

function toCreatePullRequestInput(
  options: ReleasePullRequestWorkflowOptions,
  rendered: { title: string; body: string },
  head: string
): CreatePullRequestInput {
  return {
    repository: options.repository,
    title: rendered.title,
    body: rendered.body,
    base: options.base,
    head
  };
}

async function resolvePullRequestHead(
  options: ReleasePullRequestWorkflowOptions,
  resolveCurrentBranch: (() => Promise<BranchResolutionResult>) | undefined
): Promise<BranchResolutionResult> {
  if (options.head !== undefined) {
    return { ok: true, branchName: options.head };
  }

  if (resolveCurrentBranch === undefined) {
    return {
      ok: false,
      message: "Current branch resolver was not configured."
    };
  }

  return resolveCurrentBranch();
}

function formatPullRequestDryRunOutput(input: CreatePullRequestInput): string {
  const lines = [
    "Release pull request dry run:",
    `Repository: ${formatRepository(input.repository)}`,
    `Base: ${input.base}`,
    `Head: ${input.head}`,
    `Title: ${input.title}`,
    "",
    input.body ?? ""
  ];

  return lines.join("\n");
}

function formatReleaseValidationErrors(
  errors: readonly ReleaseValidationError[]
): string {
  return [
    "Release metadata validation failed:",
    ...errors.map((error) => `- ${error.message}`)
  ].join("\n");
}

function formatBranchResolutionFailure(message: string): string {
  return [
    "Current branch resolution failed:",
    message,
    "Provide --head explicitly."
  ].join("\n");
}

function formatPullRequestCreationSuccess(
  pullRequest: PullRequestDetails
): string {
  return [
    "Created GitHub pull request:",
    `- #${pullRequest.pullRequestNumber}: ${pullRequest.title} (${pullRequest.url})`
  ].join("\n");
}

function formatPullRequestCreationFailure(title: string, message: string): string {
  return [
    `GitHub pull request creation failed: ${title}`,
    message
  ].join("\n");
}

function formatRepository(repository: RepositorySelection | undefined): string {
  return repository ? `${repository.owner}/${repository.name}` : "(inferred by gh)";
}
