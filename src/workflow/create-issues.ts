import {
  loadPlannerPlan,
  renderPlannerIssueInput,
  type PlannerPlanIssueInput,
  type PlannerPlanResult,
  type PlannerPlanValidationError
} from "../parser/plan.js";
import { GhGitHubAutomationClient } from "../github/gh-client.js";
import type { GitHubAutomationClient } from "../github/client.js";
import type {
  CreateIssueInput,
  IssueDetails,
  RepositorySelection
} from "../github/types.js";

export interface PlannerIssueWorkflowOptions {
  planPath: string;
  repository?: RepositorySelection;
  dryRun: boolean;
}

export interface PlannerIssueWorkflowDependencies {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  loadPlan?: (
    path: string
  ) => Promise<PlannerPlanResult<PlannerPlanIssueInput[]>>;
  githubClient?: GitHubAutomationClient;
  createGitHubClient?: () => GitHubAutomationClient;
}

export async function runPlannerIssueWorkflow(
  options: PlannerIssueWorkflowOptions,
  dependencies: PlannerIssueWorkflowDependencies = {}
): Promise<number> {
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;
  const loadPlan = dependencies.loadPlan ?? loadPlannerPlan;

  const plan = await loadPlan(options.planPath);
  if (!plan.ok) {
    stderr(formatValidationErrors(plan.errors));
    return 1;
  }

  if (options.dryRun) {
    stdout(formatDryRunOutput(plan.value, options.repository));
    return 0;
  }

  const client =
    dependencies.githubClient ??
    dependencies.createGitHubClient?.() ??
    new GhGitHubAutomationClient();

  return createPlannerIssues(
    plan.value,
    options.repository,
    client,
    stdout,
    stderr
  );
}

async function createPlannerIssues(
  issues: readonly PlannerPlanIssueInput[],
  repository: RepositorySelection | undefined,
  client: GitHubAutomationClient,
  stdout: (message: string) => void,
  stderr: (message: string) => void
): Promise<number> {
  const createdIssues: IssueDetails[] = [];

  for (const [index, issue] of issues.entries()) {
    const input = toCreateIssueInput(issue, index, repository);
    const result = await client.createIssue(input);

    if (!result.ok) {
      stderr(
        formatIssueCreationFailure(
          createdIssues,
          index + 1,
          input.title,
          result.error.message
        )
      );
      return 1;
    }

    createdIssues.push(result.value);
  }

  stdout(formatIssueCreationSuccess(createdIssues));
  return 0;
}

function toCreateIssueInput(
  issue: PlannerPlanIssueInput,
  planIndex: number,
  repository: RepositorySelection | undefined
): CreateIssueInput {
  const rendered = renderPlannerIssueInput(issue, { planIndex });
  return {
    repository,
    title: rendered.title,
    body: rendered.body
  };
}

function formatDryRunOutput(
  issues: readonly PlannerPlanIssueInput[],
  repository: RepositorySelection | undefined
): string {
  const lines = [
    `Planner issue dry run: ${issues.length} issue${issues.length === 1 ? "" : "s"}`
  ];

  if (repository) {
    lines.push(`Repository: ${repository.owner}/${repository.name}`);
  }

  issues.forEach((issue, index) => {
    const rendered = renderPlannerIssueInput(issue, { planIndex: index });
    lines.push("", `Issue ${index + 1}: ${rendered.title}`, "", rendered.body);
  });

  return lines.join("\n");
}

function formatValidationErrors(
  errors: readonly PlannerPlanValidationError[]
): string {
  return [
    "Planner plan validation failed:",
    ...errors.map((error) => `- ${error.message}`)
  ].join("\n");
}

function formatIssueCreationSuccess(createdIssues: readonly IssueDetails[]): string {
  return [
    `Created ${createdIssues.length} GitHub issue${createdIssues.length === 1 ? "" : "s"}:`,
    ...formatCreatedIssueLines(createdIssues)
  ].join("\n");
}

function formatIssueCreationFailure(
  createdIssues: readonly IssueDetails[],
  issueIndex: number,
  title: string,
  message: string
): string {
  const lines = [
    `GitHub issue creation failed at issue ${issueIndex}: ${title}`,
    message
  ];

  if (createdIssues.length > 0) {
    lines.push(
      "",
      `Created ${createdIssues.length} GitHub issue${createdIssues.length === 1 ? "" : "s"} before failure:`,
      ...formatCreatedIssueLines(createdIssues)
    );
  }

  return lines.join("\n");
}

function formatCreatedIssueLines(createdIssues: readonly IssueDetails[]): string[] {
  return createdIssues.map(
    (issue) => `- #${issue.issueNumber}: ${issue.title} (${issue.url})`
  );
}
