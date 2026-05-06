import assert from "node:assert/strict";
import test from "node:test";
import { runPlannerIssueWorkflow } from "../src/workflow/create-issues.js";
import type {
  AutomationResult,
  CloseIssueInput,
  CreateIssueInput,
  CreatePullRequestInput,
  GitHubAutomationClient,
  IssueDetails,
  IssueIdentifier,
  PlannerPlanIssueInput,
  PlannerPlanResult,
  PullRequestDetails
} from "../src/index.js";

const validIssue: PlannerPlanIssueInput = {
  title: "Add issue workflow",
  goal: "Move planner issue orchestration out of the CLI.",
  scope: ["Load planner plans.", "Render issue previews."],
  acceptance_criteria: [
    "Dry-run output is unchanged.",
    "Live creation uses the GitHub automation client."
  ],
  notes: ["Keep CLI parsing in src/cli.ts."]
};

const secondValidIssue: PlannerPlanIssueInput = {
  title: "Handle partial issue failures",
  goal: "Report created issues when later creation fails.",
  scope: ["Create issues sequentially.", "Stop on the first failure."],
  acceptance_criteria: [
    "Previously created issues are reported.",
    "No later issues are attempted."
  ],
  notes: ["Use existing parser and GitHub types."]
};

class FakeGitHubClient implements GitHubAutomationClient {
  readonly createIssueInputs: CreateIssueInput[] = [];

  constructor(private readonly createIssueResults: AutomationResult<IssueDetails>[]) {}

  async createIssue(
    input: CreateIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    this.createIssueInputs.push(input);
    const result = this.createIssueResults.shift();
    return (
      result ?? {
        ok: false,
        error: {
          code: "unknown",
          message: "Unexpected createIssue call."
        }
      }
    );
  }

  async getIssue(
    _input: IssueIdentifier
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("getIssue should not be called by workflow tests.");
  }

  async closeIssue(
    _input: CloseIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("closeIssue should not be called by workflow tests.");
  }

  async createPullRequest(
    _input: CreatePullRequestInput
  ): Promise<AutomationResult<PullRequestDetails>> {
    throw new Error("createPullRequest should not be called by workflow tests.");
  }
}

function successfulIssue(
  issueNumber: number,
  title: string,
  url = `https://github.com/owner/name/issues/${issueNumber}`
): AutomationResult<IssueDetails> {
  return {
    ok: true,
    value: {
      repository: { owner: "owner", name: "name" },
      issueNumber,
      title,
      state: "open",
      url
    }
  };
}

function loadPlanWith(
  result: PlannerPlanResult<PlannerPlanIssueInput[]>
): () => Promise<PlannerPlanResult<PlannerPlanIssueInput[]>> {
  return async () => result;
}

test("planner issue workflow dry-run renders preview without creating a GitHub client", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runPlannerIssueWorkflow(
    {
      planPath: "plan.json",
      repository: { owner: "owner", name: "name" },
      dryRun: true
    },
    {
      loadPlan: loadPlanWith({ ok: true, value: [validIssue] }),
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      createGitHubClient: () => {
        throw new Error("GitHub client should not be created during dry-run.");
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.match(stdout.join("\n"), /Planner issue dry run: 1 issue/);
  assert.match(stdout.join("\n"), /Repository: owner\/name/);
  assert.match(stdout.join("\n"), /Issue 1: Add issue workflow/);
  assert.match(stdout.join("\n"), /## Goal/);
  assert.match(stdout.join("\n"), /Move planner issue orchestration out of the CLI/);
});

test("planner issue workflow reports validation failure before GitHub creation", async () => {
  const client = new FakeGitHubClient([successfulIssue(1, validIssue.title)]);
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runPlannerIssueWorkflow(
    {
      planPath: "plan.json",
      dryRun: false
    },
    {
      loadPlan: loadPlanWith({
        ok: false,
        errors: [{ message: "Issue 0 field goal is required." }]
      }),
      githubClient: client,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout.length, 0);
  assert.equal(client.createIssueInputs.length, 0);
  assert.match(stderr.join("\n"), /Planner plan validation failed/);
  assert.match(stderr.join("\n"), /Issue 0 field goal is required/);
});

test("planner issue workflow creates live issues sequentially in plan order", async () => {
  const client = new FakeGitHubClient([
    successfulIssue(1, validIssue.title),
    successfulIssue(2, secondValidIssue.title)
  ]);
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runPlannerIssueWorkflow(
    {
      planPath: "plan.json",
      repository: { owner: "owner", name: "name" },
      dryRun: false
    },
    {
      loadPlan: loadPlanWith({ ok: true, value: [validIssue, secondValidIssue] }),
      githubClient: client,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.deepEqual(
    client.createIssueInputs.map((input) => input.title),
    [validIssue.title, secondValidIssue.title]
  );
  assert.deepEqual(client.createIssueInputs[0]?.repository, {
    owner: "owner",
    name: "name"
  });
  assert.match(client.createIssueInputs[0]?.body ?? "", /## Scope/);
  assert.match(stdout.join("\n"), /Created 2 GitHub issues/);
  assert.match(stdout.join("\n"), /#2: Handle partial issue failures/);
});

test("planner issue workflow stops on first failure and reports partial creation", async () => {
  const client = new FakeGitHubClient([
    successfulIssue(1, validIssue.title),
    {
      ok: false,
      error: {
        code: "permission_denied",
        message: "gh lacks permission to create issues."
      }
    }
  ]);
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runPlannerIssueWorkflow(
    {
      planPath: "plan.json",
      dryRun: false
    },
    {
      loadPlan: loadPlanWith({
        ok: true,
        value: [validIssue, secondValidIssue, validIssue]
      }),
      githubClient: client,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout.length, 0);
  assert.equal(client.createIssueInputs.length, 2);
  assert.match(
    stderr.join("\n"),
    /GitHub issue creation failed at issue 2: Handle partial issue failures/
  );
  assert.match(stderr.join("\n"), /gh lacks permission to create issues/);
  assert.match(stderr.join("\n"), /Created 1 GitHub issue before failure/);
  assert.match(stderr.join("\n"), /#1: Add issue workflow/);
});
