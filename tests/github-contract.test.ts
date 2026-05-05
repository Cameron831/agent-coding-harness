import assert from "node:assert/strict";
import test from "node:test";
import type {
  AutomationResult,
  GitHubAutomationClient,
  IssueDetails,
  PullRequestDetails,
  RepositorySelection
} from "../src/index.js";

const repository: RepositorySelection = {
  owner: "example",
  name: "agent-workforce"
};

function ok<T>(value: T): AutomationResult<T> {
  return { ok: true, value };
}

test("GitHubAutomationClient can be satisfied by a typed fake client", async () => {
  let linkedIssueNumber: number | undefined;
  const fakeClient: GitHubAutomationClient = {
    async createIssue(input) {
      return ok<IssueDetails>({
        ...input,
        issueNumber: 6,
        state: "open",
        url: "https://github.com/example/agent-workforce/issues/6"
      });
    },
    async getIssue(input) {
      return ok<IssueDetails>({
        ...input,
        title: "Add TypeScript project scaffolding",
        state: "open",
        url: "https://github.com/example/agent-workforce/issues/6"
      });
    },
    async closeIssue(input) {
      return ok<IssueDetails>({
        ...input,
        title: "Add TypeScript project scaffolding",
        state: "closed",
        url: "https://github.com/example/agent-workforce/issues/6"
      });
    },
    async createPullRequest(input) {
      linkedIssueNumber = input.linkedIssueNumber;

      return ok<PullRequestDetails>({
        ...input,
        pullRequestNumber: 12,
        state: "open",
        url: "https://github.com/example/agent-workforce/pull/12"
      });
    }
  };

  const issue = await fakeClient.createIssue({
    repository,
    title: "Add TypeScript project scaffolding",
    body: "Define the public GitHub automation contract.",
    labels: ["typescript"]
  });
  const pullRequest = await fakeClient.createPullRequest({
    repository,
    title: "Add GitHub automation contract",
    head: "issue-6-contract",
    base: "main",
    linkedIssueNumber: 6
  });

  assert.equal(issue.ok && issue.value.issueNumber, 6);
  assert.equal(pullRequest.ok && pullRequest.value.base, "main");
  assert.equal(linkedIssueNumber, 6);
});
