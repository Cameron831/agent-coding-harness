import assert from "node:assert/strict";
import test from "node:test";
import { GhGitHubAutomationClient, type GhCommandRunner } from "../src/index.js";
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

function issueJson(state = "OPEN"): string {
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

function pullRequestJson(state = "OPEN"): string {
  return JSON.stringify({
    number: 12,
    title: "Add pull request support",
    state,
    url: "https://github.com/example/agent-workforce/pull/12",
    body: "Implement pull request creation.",
    headRefName: "issue-8-pr-create",
    baseRefName: "main",
    isDraft: true
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
  const client = new GhGitHubAutomationClient(runner);

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
  const client = new GhGitHubAutomationClient(runner);

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
  const client = new GhGitHubAutomationClient(runner);

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

test("getIssue normalizes uppercase issue state from gh JSON", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: issueJson("CLOSED"),
      stderr: ""
    }
  ];
  const client = new GhGitHubAutomationClient(runner);

  const result = await client.getIssue({ repository, issueNumber: 6 });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.state, "closed");
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
  const client = new GhGitHubAutomationClient(runner);

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
  const client = new GhGitHubAutomationClient(runner);

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
  const client = new GhGitHubAutomationClient(runner);

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
  const client = new GhGitHubAutomationClient(runner);

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
  const client = new GhGitHubAutomationClient(runner);

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
  const client = new GhGitHubAutomationClient(runner);

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

test("createPullRequest creates a PR, views it, and parses JSON", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "https://github.com/example/agent-workforce/pull/12\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: pullRequestJson(),
      stderr: ""
    }
  ];
  const client = new GhGitHubAutomationClient(runner);

  const result = await client.createPullRequest({
    repository,
    title: "Add pull request support",
    head: "issue-8-pr-create",
    base: "main",
    body: "Implement pull request creation.",
    draft: true
  });

  assert.deepEqual(runner.calls, [
    [
      "pr",
      "create",
      "--title",
      "Add pull request support",
      "--head",
      "issue-8-pr-create",
      "--base",
      "main",
      "--body",
      "Implement pull request creation.",
      "--draft",
      "--repo",
      "example/agent-workforce"
    ],
    [
      "pr",
      "view",
      "12",
      "--json",
      "number,title,state,url,body,headRefName,baseRefName,isDraft",
      "--repo",
      "example/agent-workforce"
    ]
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.pullRequestNumber, 12);
  assert.equal(result.ok && result.value.state, "open");
  assert.equal(result.ok && result.value.head, "issue-8-pr-create");
  assert.equal(result.ok && result.value.base, "main");
  assert.equal(result.ok && result.value.draft, true);
  assert.equal(result.ok && result.value.repository, repository);
});

test("createPullRequest omits repository args when repository is not supplied", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "https://github.com/example/agent-workforce/pull/12\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: pullRequestJson(),
      stderr: ""
    }
  ];
  const client = new GhGitHubAutomationClient(runner);

  const result = await client.createPullRequest({
    title: "Infer pull request repository",
    head: "feature",
    base: "main",
    body: "Create a PR with gh repository inference."
  });

  assert.deepEqual(runner.calls, [
    [
      "pr",
      "create",
      "--title",
      "Infer pull request repository",
      "--head",
      "feature",
      "--base",
      "main",
      "--body",
      "Create a PR with gh repository inference."
    ],
    [
      "pr",
      "view",
      "12",
      "--json",
      "number,title,state,url,body,headRefName,baseRefName,isDraft"
    ]
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.repository, undefined);
});

test("createPullRequest appends a closing reference for linkedIssueNumber", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "https://github.com/example/agent-workforce/pull/12\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: pullRequestJson(),
      stderr: ""
    }
  ];
  const client = new GhGitHubAutomationClient(runner);

  const result = await client.createPullRequest({
    repository,
    title: "Add pull request support",
    head: "issue-8-pr-create",
    base: "main",
    body: "Implement pull request creation.",
    linkedIssueNumber: 8
  });

  assert.equal(result.ok, true);
  assert.deepEqual(runner.calls[0], [
    "pr",
    "create",
    "--title",
    "Add pull request support",
    "--head",
    "issue-8-pr-create",
    "--base",
    "main",
    "--body",
    "Implement pull request creation.\n\nCloses #8",
    "--repo",
    "example/agent-workforce"
  ]);
});

test("createPullRequest uses closing reference as the body when body is omitted", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "https://github.com/example/agent-workforce/pull/12\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: pullRequestJson(),
      stderr: ""
    }
  ];
  const client = new GhGitHubAutomationClient(runner);

  const result = await client.createPullRequest({
    repository,
    title: "Add pull request support",
    head: "issue-8-pr-create",
    base: "main",
    linkedIssueNumber: 8
  });

  assert.equal(result.ok, true);
  assert.deepEqual(runner.calls[0], [
    "pr",
    "create",
    "--title",
    "Add pull request support",
    "--head",
    "issue-8-pr-create",
    "--base",
    "main",
    "--body",
    "Closes #8",
    "--repo",
    "example/agent-workforce"
  ]);
});

test("createPullRequest does not duplicate existing closing references", async () => {
  const fixesRunner = new FakeRunner();
  fixesRunner.results = [
    {
      exitCode: 0,
      stdout: "https://github.com/example/agent-workforce/pull/12\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: pullRequestJson(),
      stderr: ""
    }
  ];
  const closesRunner = new FakeRunner();
  closesRunner.results = [
    {
      exitCode: 0,
      stdout: "https://github.com/example/agent-workforce/pull/12\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: pullRequestJson(),
      stderr: ""
    }
  ];

  await new GhGitHubAutomationClient(fixesRunner).createPullRequest({
    repository,
    title: "Add pull request support",
    head: "issue-8-pr-create",
    base: "main",
    body: "Fixes #8",
    linkedIssueNumber: 8
  });
  await new GhGitHubAutomationClient(closesRunner).createPullRequest({
    repository,
    title: "Add pull request support",
    head: "issue-8-pr-create",
    base: "main",
    body: "Closes #8",
    linkedIssueNumber: 8
  });

  assert.equal(fixesRunner.calls[0][9], "Fixes #8");
  assert.equal(closesRunner.calls[0][9], "Closes #8");
});

test("createPullRequest validation failures return before invoking the runner", async () => {
  const runner = new FakeRunner();
  const client = new GhGitHubAutomationClient(runner);

  const missingTitle = await client.createPullRequest({
    repository,
    title: " ",
    head: "feature",
    base: "main"
  });
  const missingHead = await client.createPullRequest({
    repository,
    title: "Add pull request support",
    head: " ",
    base: "main"
  });
  const missingBase = await client.createPullRequest({
    repository,
    title: "Add pull request support",
    head: "feature",
    base: ""
  });
  const invalidRepository = await client.createPullRequest({
    repository: { owner: "example", name: "" },
    title: "Add pull request support",
    head: "feature",
    base: "main"
  });
  const invalidLinkedIssue = await client.createPullRequest({
    repository,
    title: "Add pull request support",
    head: "feature",
    base: "main",
    linkedIssueNumber: 0
  });

  assert.equal(missingTitle.ok, false);
  assert.equal(!missingTitle.ok && missingTitle.error.code, "validation_failed");
  assert.equal(missingHead.ok, false);
  assert.equal(!missingHead.ok && missingHead.error.code, "validation_failed");
  assert.equal(missingBase.ok, false);
  assert.equal(!missingBase.ok && missingBase.error.code, "validation_failed");
  assert.equal(invalidRepository.ok, false);
  assert.equal(!invalidRepository.ok && invalidRepository.error.code, "validation_failed");
  assert.equal(invalidLinkedIssue.ok, false);
  assert.equal(!invalidLinkedIssue.ok && invalidLinkedIssue.error.code, "validation_failed");
  assert.deepEqual(runner.calls, []);
});

test("createPullRequest returns a failure for non-zero gh results", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 1,
      stdout: "",
      stderr: "could not create pull request"
    }
  ];
  const client = new GhGitHubAutomationClient(runner);

  const result = await client.createPullRequest({
    repository,
    title: "Add pull request support",
    head: "feature",
    base: "main"
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "unknown");
  assert.match(!result.ok ? result.error.message : "", /pull request/);
});

test("createPullRequest returns a failure when the PR URL cannot be parsed", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "created pull request\n",
      stderr: ""
    }
  ];
  const client = new GhGitHubAutomationClient(runner);

  const result = await client.createPullRequest({
    repository,
    title: "Add pull request support",
    head: "feature",
    base: "main"
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "unknown");
  assert.match(!result.ok ? result.error.message : "", /pull request number/);
  assert.equal(runner.calls.length, 1);
});

test("createPullRequest returns a failure for malformed PR JSON", async () => {
  const runner = new FakeRunner();
  runner.results = [
    {
      exitCode: 0,
      stdout: "https://github.com/example/agent-workforce/pull/12\n",
      stderr: ""
    },
    {
      exitCode: 0,
      stdout: JSON.stringify({ number: 12 }),
      stderr: ""
    }
  ];
  const client = new GhGitHubAutomationClient(runner);

  const result = await client.createPullRequest({
    repository,
    title: "Add pull request support",
    head: "feature",
    base: "main"
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "unknown");
  assert.match(!result.ok ? result.error.message : "", /parse/);
});
