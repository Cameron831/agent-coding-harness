import assert from "node:assert/strict";
import test from "node:test";
import { GhGitHubIssueClient, type GhCommandRunner } from "../src/index.js";
import type { RepositorySelection } from "../src/index.js";

const repository: RepositorySelection = {
  owner: "example",
  name: "agent-workforce"
};

class FakeRunner implements GhCommandRunner {
  calls: string[][] = [];
  results = [
    {
      exitCode: 0,
      stdout: issueJson(),
      stderr: ""
    }
  ];

  async run(args: readonly string[]) {
    this.calls.push([...args]);
    return this.results.shift() ?? { exitCode: 0, stdout: issueJson(), stderr: "" };
  }
}

function issueJson(state = "open"): string {
  return JSON.stringify({
    number: 6,
    title: "Add gh issue client",
    state,
    url: "https://github.com/example/agent-workforce/issues/6",
    body: "Implement issue commands.",
    labels: [{ name: "bug" }, { name: "typescript" }],
    assignees: [{ login: "octocat" }, { login: "hubot" }]
  });
}

test("createIssue creates without JSON, views the issue, and parses JSON", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "https://github.com/example/agent-workforce/issues/6\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: issueJson(),
      stderr: ""
    }
  ];
  const client = new GhGitHubIssueClient(runner);

  const result = await client.createIssue({
    repository,
    title: "Add gh issue client",
    body: "Implement issue commands.",
    labels: ["bug", "typescript"],
    assignees: ["octocat", "hubot"]
  });

  assert.deepEqual(runner.calls, [
    [
      "issue",
      "create",
      "--title",
      "Add gh issue client",
      "--body",
      "Implement issue commands.",
      "--label",
      "bug",
      "--label",
      "typescript",
      "--assignee",
      "octocat",
      "--assignee",
      "hubot",
      "--repo",
      "example/agent-workforce"
    ],
    [
      "issue",
      "view",
      "6",
      "--json",
      "number,title,state,url,body,labels,assignees",
      "--repo",
      "example/agent-workforce"
    ]
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.issueNumber, 6);
  assert.equal(result.ok && result.value.repository, repository);
  assert.equal(result.ok && result.value.body, "Implement issue commands.");
  assert.deepEqual(result.ok && result.value.labels, ["bug", "typescript"]);
  assert.deepEqual(result.ok && result.value.assignees, ["octocat", "hubot"]);
});

test("createIssue omits --repo and --body when not supplied", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "https://github.com/example/agent-workforce/issues/6\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: issueJson(),
      stderr: ""
    }
  ];
  const client = new GhGitHubIssueClient(runner);

  const result = await client.createIssue({ title: "Infer repository" });

  assert.deepEqual(runner.calls, [
    [
      "issue",
      "create",
      "--title",
      "Infer repository"
    ],
    [
      "issue",
      "view",
      "6",
      "--json",
      "number,title,state,url,body,labels,assignees"
    ]
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.repository, undefined);
});

test("getIssue constructs gh issue view with issue number", async () => {
  const runner = new FakeRunner();
  const client = new GhGitHubIssueClient(runner);

  const result = await client.getIssue({ repository, issueNumber: 6 });

  assert.deepEqual(runner.calls, [
    [
      "issue",
      "view",
      "6",
      "--json",
      "number,title,state,url,body,labels,assignees",
      "--repo",
      "example/agent-workforce"
    ]
  ]);
  assert.equal(result.ok, true);
});

test("closeIssue closes without JSON, views the issue, and parses JSON", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: issueJson("closed"),
      stderr: ""
    }
  ];
  const client = new GhGitHubIssueClient(runner);

  const result = await client.closeIssue({
    repository,
    issueNumber: 6,
    reason: "completed"
  });

  assert.deepEqual(runner.calls, [
    [
      "issue",
      "close",
      "6",
      "--reason",
      "completed",
      "--repo",
      "example/agent-workforce"
    ],
    [
      "issue",
      "view",
      "6",
      "--json",
      "number,title,state,url,body,labels,assignees",
      "--repo",
      "example/agent-workforce"
    ]
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.state, "closed");
});

test("closeIssue passes not planned reason directly to gh", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: issueJson("closed"),
      stderr: ""
    }
  ];
  const client = new GhGitHubIssueClient(runner);

  const result = await client.closeIssue({
    repository,
    issueNumber: 6,
    reason: "not planned"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(runner.calls[0], [
    "issue",
    "close",
    "6",
    "--reason",
    "not planned",
    "--repo",
    "example/agent-workforce"
  ]);
});

test("validation failures return before invoking the runner", async () => {
  const runner = new FakeRunner();
  const client = new GhGitHubIssueClient(runner);

  const missingTitle = await client.createIssue({ repository, title: " " });
  const emptyLabel = await client.createIssue({
    repository,
    title: "Issue with invalid label",
    labels: ["bug", " "]
  });
  const emptyAssignee = await client.createIssue({
    repository,
    title: "Issue with invalid assignee",
    assignees: ["octocat", ""]
  });
  const invalidIssueNumber = await client.getIssue({ repository, issueNumber: 0 });
  const invalidRepository = await client.closeIssue({
    repository: { owner: "", name: "agent-workforce" },
    issueNumber: 6
  });

  assert.equal(missingTitle.ok, false);
  assert.equal(!missingTitle.ok && missingTitle.error.code, "validation_failed");
  assert.equal(emptyLabel.ok, false);
  assert.equal(!emptyLabel.ok && emptyLabel.error.code, "validation_failed");
  assert.equal(emptyAssignee.ok, false);
  assert.equal(!emptyAssignee.ok && emptyAssignee.error.code, "validation_failed");
  assert.equal(invalidIssueNumber.ok, false);
  assert.equal(!invalidIssueNumber.ok && invalidIssueNumber.error.code, "validation_failed");
  assert.equal(invalidRepository.ok, false);
  assert.equal(!invalidRepository.ok && invalidRepository.error.code, "validation_failed");
  assert.deepEqual(runner.calls, []);
});

test("non-zero gh results return an automation failure", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 1,
      stdout: "",
      stderr: "could not create issue"
    }
  ];
  const client = new GhGitHubIssueClient(runner);

  const result = await client.createIssue({ repository, title: "Failing issue" });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "unknown");
  assert.match(!result.ok ? result.error.message : "", /could not create issue/);
});

test("invalid JSON returns an automation failure", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "{not valid",
      stderr: ""
    }
  ];
  const client = new GhGitHubIssueClient(runner);

  const result = await client.getIssue({ repository, issueNumber: 6 });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "unknown");
  assert.match(!result.ok ? result.error.message : "", /parse/);
});

test("createIssue returns a failure when the issue URL cannot be parsed", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "created issue\n",
      stderr: ""
    }
  ];
  const client = new GhGitHubIssueClient(runner);

  const result = await client.createIssue({ repository, title: "Missing URL" });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "unknown");
  assert.match(!result.ok ? result.error.message : "", /issue number/);
  assert.deepEqual(runner.calls, [
    [
      "issue",
      "create",
      "--title",
      "Missing URL",
      "--repo",
      "example/agent-workforce"
    ]
  ]);
});

test("gh issue client does not expose a pull request placeholder", () => {
  const runner = new FakeRunner();
  const client = new GhGitHubIssueClient(runner);

  assert.equal("createPullRequest" in client, false);
  assert.deepEqual(runner.calls, []);
});
