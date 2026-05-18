import assert from "node:assert/strict";
import test from "node:test";
import { runReleasePullRequestWorkflow } from "../src/workflow/create-pull-request.js";
import type {
  AutomationResult,
  BranchResolutionResult,
  CloseIssueInput,
  CreateIssueInput,
  CreatePullRequestInput,
  GitHubAutomationClient,
  ImplementorReleaseMetadata,
  IssueDetails,
  IssueIdentifier,
  ListOpenPullRequestsInput,
  PullRequestDetails
} from "../src/index.js";

const validRelease: ImplementorReleaseMetadata = {
  commit_message: "Add manual PR CLI",
  pull_request: {
    title: "Add manual pull request CLI",
    summary: "Creates pull requests from implementor release metadata.",
    scope: ["Parse release CLI arguments.", "Create pull requests."],
    verification: ["npm test"]
  }
};

class FakeGitHubClient implements GitHubAutomationClient {
  readonly createPullRequestInputs: CreatePullRequestInput[] = [];

  constructor(
    private readonly createPullRequestResults: AutomationResult<PullRequestDetails>[]
  ) {}

  async createIssue(
    _input: CreateIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("createIssue should not be called by PR workflow tests.");
  }

  async getIssue(
    _input: IssueIdentifier
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("getIssue should not be called by PR workflow tests.");
  }

  async closeIssue(
    _input: CloseIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("closeIssue should not be called by PR workflow tests.");
  }

  async listOpenPullRequests(
    _input: ListOpenPullRequestsInput
  ): Promise<AutomationResult<PullRequestDetails[]>> {
    throw new Error("listOpenPullRequests should not be called by PR workflow tests.");
  }

  async createPullRequest(
    input: CreatePullRequestInput
  ): Promise<AutomationResult<PullRequestDetails>> {
    this.createPullRequestInputs.push(input);
    const result = this.createPullRequestResults.shift();
    return (
      result ?? {
        ok: false,
        error: {
          code: "unknown",
          message: "Unexpected createPullRequest call."
        }
      }
    );
  }
}

function successfulPullRequest(
  pullRequestNumber: number,
  title: string,
  url = `https://github.com/owner/name/pull/${pullRequestNumber}`
): AutomationResult<PullRequestDetails> {
  return {
    ok: true,
    value: {
      repository: { owner: "owner", name: "name" },
      pullRequestNumber,
      title,
      state: "open",
      url,
      base: "main",
      head: "feature/manual-pr-cli"
    }
  };
}

function resolvedBranch(branchName: string): BranchResolutionResult {
  return { ok: true, branchName };
}

test("release PR workflow dry-run prints resolved input without creating a GitHub client", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runReleasePullRequestWorkflow(
    {
      releasePath: "release.json",
      repository: { owner: "owner", name: "name" },
      base: "develop",
      head: "feature/manual-pr-cli",
      dryRun: true
    },
    {
      loadRelease: async () => ({ ok: true, value: validRelease }),
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      createGitHubClient: () => {
        throw new Error("GitHub client should not be created during PR dry-run.");
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.match(stdout.join("\n"), /pull request dry run/i);
  assert.match(stdout.join("\n"), /Repository: owner\/name/);
  assert.match(stdout.join("\n"), /Base: develop/);
  assert.match(stdout.join("\n"), /Head: feature\/manual-pr-cli/);
  assert.match(stdout.join("\n"), /Title: Add manual pull request CLI/);
  assert.match(
    stdout.join("\n"),
    /Creates pull requests from implementor release metadata/
  );
  assert.match(stdout.join("\n"), /- Parse release CLI arguments\./);
});

test("release PR workflow reports validation failure before branch resolution or GitHub creation", async () => {
  let branchResolved = false;
  const stderr: string[] = [];

  const exitCode = await runReleasePullRequestWorkflow(
    {
      releasePath: "release.json",
      base: "main",
      dryRun: false
    },
    {
      loadRelease: async () => ({
        ok: false,
        errors: [
          {
            message: "Release metadata field pull_request.title is required."
          }
        ]
      }),
      resolveCurrentBranch: async () => {
        branchResolved = true;
        return resolvedBranch("feature/manual-pr-cli");
      },
      createGitHubClient: () => {
        throw new Error("GitHub client should not be created for invalid release metadata.");
      },
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(branchResolved, false);
  assert.match(stderr.join("\n"), /Release metadata validation failed/);
  assert.match(
    stderr.join("\n"),
    /Release metadata field pull_request\.title is required/
  );
});

test("release PR workflow resolves default head before GitHub mutation", async () => {
  const client = new FakeGitHubClient([
    successfulPullRequest(7, validRelease.pull_request.title)
  ]);
  const stdout: string[] = [];

  const exitCode = await runReleasePullRequestWorkflow(
    {
      releasePath: "release.json",
      repository: { owner: "owner", name: "name" },
      base: "main",
      dryRun: false
    },
    {
      loadRelease: async () => ({ ok: true, value: validRelease }),
      resolveCurrentBranch: async () => resolvedBranch("feature/manual-pr-cli"),
      githubClient: client,
      stdout: (message) => stdout.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(client.createPullRequestInputs.length, 1);
  assert.equal(client.createPullRequestInputs[0]?.head, "feature/manual-pr-cli");
});

test("release PR workflow fails branch resolution before GitHub mutation", async () => {
  const stderr: string[] = [];

  const exitCode = await runReleasePullRequestWorkflow(
    {
      releasePath: "release.json",
      base: "main",
      dryRun: false
    },
    {
      loadRelease: async () => ({ ok: true, value: validRelease }),
      resolveCurrentBranch: async () => ({ ok: false, message: "detached HEAD" }),
      createGitHubClient: () => {
        throw new Error("GitHub client should not be created when branch resolution fails.");
      },
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 1);
  assert.match(stderr.join("\n"), /detached HEAD/);
  assert.match(stderr.join("\n"), /--head/);
});

test("release PR workflow explicit head bypasses current branch resolution", async () => {
  const client = new FakeGitHubClient([
    successfulPullRequest(8, validRelease.pull_request.title)
  ]);
  const stdout: string[] = [];

  const exitCode = await runReleasePullRequestWorkflow(
    {
      releasePath: "release.json",
      repository: { owner: "owner", name: "name" },
      base: "develop",
      head: "feature/explicit-head",
      dryRun: false
    },
    {
      loadRelease: async () => ({ ok: true, value: validRelease }),
      resolveCurrentBranch: async () => {
        throw new Error("Current branch should not be resolved when head is set.");
      },
      githubClient: client,
      stdout: (message) => stdout.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(client.createPullRequestInputs.length, 1);
  assert.equal(client.createPullRequestInputs[0]?.base, "develop");
  assert.equal(client.createPullRequestInputs[0]?.head, "feature/explicit-head");
});

test("release PR workflow live success forwards input and reports created PR", async () => {
  const client = new FakeGitHubClient([
    successfulPullRequest(9, validRelease.pull_request.title)
  ]);
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runReleasePullRequestWorkflow(
    {
      releasePath: "release.json",
      repository: { owner: "owner", name: "name" },
      base: "main",
      head: "feature/manual-pr-cli",
      dryRun: false
    },
    {
      loadRelease: async () => ({ ok: true, value: validRelease }),
      githubClient: client,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.deepEqual(client.createPullRequestInputs[0]?.repository, {
    owner: "owner",
    name: "name"
  });
  assert.equal(
    client.createPullRequestInputs[0]?.title,
    "Add manual pull request CLI"
  );
  assert.match(
    client.createPullRequestInputs[0]?.body ?? "",
    /Creates pull requests from implementor release metadata/
  );
  assert.equal(client.createPullRequestInputs[0]?.base, "main");
  assert.equal(client.createPullRequestInputs[0]?.head, "feature/manual-pr-cli");
  assert.match(stdout.join("\n"), /Created GitHub pull request/);
  assert.match(stdout.join("\n"), /#9: Add manual pull request CLI/);
  assert.match(stdout.join("\n"), /https:\/\/github.com\/owner\/name\/pull\/9/);
});

test("release PR workflow live failure includes the underlying GitHub error", async () => {
  const client = new FakeGitHubClient([
    {
      ok: false,
      error: {
        code: "permission_denied",
        message: "gh lacks permission to create pull requests."
      }
    }
  ]);
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runReleasePullRequestWorkflow(
    {
      releasePath: "release.json",
      repository: { owner: "owner", name: "name" },
      base: "main",
      head: "feature/manual-pr-cli",
      dryRun: false
    },
    {
      loadRelease: async () => ({ ok: true, value: validRelease }),
      githubClient: client,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout.length, 0);
  assert.equal(client.createPullRequestInputs.length, 1);
  assert.match(stderr.join("\n"), /GitHub pull request creation failed/);
  assert.match(stderr.join("\n"), /gh lacks permission to create pull requests/);
});
