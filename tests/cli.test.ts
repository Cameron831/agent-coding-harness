import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatUsage, parseCliArgs, parseRepository, runCli } from "../src/cli.js";
import type {
  AutomationResult,
  CloseIssueInput,
  CreateIssueInput,
  CreatePullRequestInput,
  GitHubAutomationClient,
  IssueDetails,
  IssueIdentifier,
  ListOpenPullRequestsInput,
  PlannerPlanIssueInput,
  PlannerPlanResult,
  PullRequestDetails
} from "../src/index.js";

const validIssue: PlannerPlanIssueInput = {
  title: "Add issue dry-run CLI",
  goal: "Preview planned GitHub issues without mutating GitHub.",
  scope: ["Parse CLI arguments.", "Render issue bodies."],
  acceptance_criteria: [
    "Dry-run output includes each planned issue title.",
    "Rendered bodies match the planner renderer."
  ],
  notes: ["Do not instantiate the GitHub issue creation client."]
};

const secondValidIssue: PlannerPlanIssueInput = {
  title: "Add live planner issue creation",
  goal: "Create planned GitHub issues from a validated planner artifact.",
  scope: ["Convert issue input.", "Call the GitHub automation client."],
  acceptance_criteria: [
    "Issues are created in plan order.",
    "Creation stops on the first failure."
  ],
  notes: ["Do not construct gh commands in the CLI."]
};

class FakeGitHubClient implements GitHubAutomationClient {
  readonly createIssueInputs: CreateIssueInput[] = [];
  readonly createPullRequestInputs: CreatePullRequestInput[] = [];

  constructor(
    private readonly createIssueResults: AutomationResult<IssueDetails>[],
    private readonly createPullRequestResults: AutomationResult<PullRequestDetails>[] = []
  ) {}

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
    throw new Error("getIssue should not be called by CLI tests.");
  }

  async closeIssue(
    _input: CloseIssueInput
  ): Promise<AutomationResult<IssueDetails>> {
    throw new Error("closeIssue should not be called by CLI tests.");
  }

  async listOpenPullRequests(
    _input: ListOpenPullRequestsInput
  ): Promise<AutomationResult<PullRequestDetails[]>> {
    throw new Error("listOpenPullRequests should not be called by CLI tests.");
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

test("routes run subcommand to injected runner with forwarded argv", async () => {
  let capturedArgs: readonly string[] | undefined;
  let capturedStdout: unknown;
  let capturedStderr: unknown;
  const stdout = () => undefined;
  const stderr = () => undefined;

  const exitCode = await runCli(["run", "--issue", "77"], {
    stdout,
    stderr,
    runRunCli: async (args, options) => {
      capturedArgs = args;
      capturedStdout = options?.stdout;
      capturedStderr = options?.stderr;
      return 11;
    }
  });

  assert.equal(exitCode, 11);
  assert.deepEqual(capturedArgs, ["--issue", "77"]);
  assert.equal(capturedStdout, stdout);
  assert.equal(capturedStderr, stderr);
});

test("routes run subcommand through injected stage runners", async () => {
  const calls: string[] = [];
  const stdout: string[] = [];

  const exitCode = await runCli(["run", "--issue", "77"], {
    stdout: (message) => stdout.push(message),
    runPrepareCli: async (args) => {
      calls.push(`prepare:${args.join(" ")}`);
      return 0;
    },
    runImplementCli: async (args) => {
      calls.push(`implement:${args.join(" ")}`);
      return 0;
    },
    runReleaseCli: async (args) => {
      calls.push(`release:${args.join(" ")}`);
      return 0;
    }
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    "prepare:--issue 77",
    "implement:--issue 77",
    "release:--issue 77"
  ]);
  assert.match(stdout.join("\n"), /issue #77/);
});

test("routes prepare subcommand to injected runner with forwarded argv", async () => {
  let capturedArgs: readonly string[] | undefined;
  let capturedStdout: unknown;
  let capturedStderr: unknown;
  const stdout = () => undefined;
  const stderr = () => undefined;

  const exitCode = await runCli(
    ["prepare", "--issue", "77", "--target-repo", "repo"],
    {
      stdout,
      stderr,
      runPrepareCli: async (args, options) => {
        capturedArgs = args;
        capturedStdout = options?.stdout;
        capturedStderr = options?.stderr;
        return 17;
      }
    }
  );

  assert.equal(exitCode, 17);
  assert.deepEqual(capturedArgs, ["--issue", "77", "--target-repo", "repo"]);
  assert.equal(capturedStdout, stdout);
  assert.equal(capturedStderr, stderr);
});

test("routes implement subcommand to injected runner with forwarded argv", async () => {
  let capturedArgs: readonly string[] | undefined;

  const exitCode = await runCli(
    ["implement", "--issue", "77", "--prompt", "prompt.md"],
    {
      runImplementCli: async (args) => {
        capturedArgs = args;
        return 23;
      }
    }
  );

  assert.equal(exitCode, 23);
  assert.deepEqual(capturedArgs, ["--issue", "77", "--prompt", "prompt.md"]);
});

test("routes release subcommand to injected runner with forwarded argv", async () => {
  let capturedArgs: readonly string[] | undefined;

  const exitCode = await runCli(
    ["release", "--issue", "77"],
    {
      runReleaseCli: async (args) => {
        capturedArgs = args;
        return 31;
      }
    }
  );

  assert.equal(exitCode, 31);
  assert.deepEqual(capturedArgs, ["--issue", "77"]);
});

test("routes cleanup subcommand to injected runner with forwarded argv", async () => {
  let capturedArgs: readonly string[] | undefined;
  let capturedStdout: unknown;
  let capturedStderr: unknown;
  const stdout = () => undefined;
  const stderr = () => undefined;

  const exitCode = await runCli(["cleanup", "--issue", "77"], {
    stdout,
    stderr,
    runCleanupCli: async (args, options) => {
      capturedArgs = args;
      capturedStdout = options?.stdout;
      capturedStderr = options?.stderr;
      return 37;
    }
  });

  assert.equal(exitCode, 37);
  assert.deepEqual(capturedArgs, ["--issue", "77"]);
  assert.equal(capturedStdout, stdout);
  assert.equal(capturedStderr, stderr);
});

test("unknown subcommands and missing arguments return top-level usage", async () => {
  const unknownStderr: string[] = [];
  const missingStderr: string[] = [];

  const unknownExitCode = await runCli(["deploy"], {
    stderr: (message) => unknownStderr.push(message)
  });
  const missingExitCode = await runCli([], {
    stderr: (message) => missingStderr.push(message)
  });

  assert.equal(unknownExitCode, 1);
  assert.match(unknownStderr.join("\n"), /Unexpected positional argument: deploy/);
  assert.match(unknownStderr.join("\n"), /agent-workforce run --issue <number>/);
  assert.match(unknownStderr.join("\n"), /agent-workforce prepare/);
  assert.match(unknownStderr.join("\n"), /agent-workforce release/);

  assert.equal(missingExitCode, 1);
  assert.match(missingStderr.join("\n"), /--plan is required/);
  assert.match(missingStderr.join("\n"), /agent-workforce implement/);
});

test("top-level usage lists staged commands without workflow-local options", () => {
  const usage = formatUsage();

  assert.match(usage, /agent-workforce run --issue <number>/);
  assert.match(usage, /agent-workforce prepare \[prepare options\]/);
  assert.match(usage, /agent-workforce implement \[implement options\]/);
  assert.match(usage, /agent-workforce release \[release publish options\]/);
  assert.match(usage, /agent-workforce cleanup \[cleanup options\]/);
  assert.match(usage, /agent-workforce --plan <path>/);
  assert.doesNotMatch(usage, /agent-workforce --release/);
  assert.doesNotMatch(usage, /agent-workforce-release-pr/);
  assert.doesNotMatch(usage, /--base/);
  assert.doesNotMatch(usage, /--head/);
  assert.doesNotMatch(usage, /manual PR/);
  assert.doesNotMatch(usage, /--target-repo/);
  assert.doesNotMatch(usage, /--worktree-parent/);
});

test("package scripts expose top-level staged workflow commands", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.equal(packageJson.scripts.workflow, "node dist/src/cli.js");
  assert.equal(packageJson.scripts["workflow:run"], "node dist/src/cli.js run");
  assert.equal(packageJson.scripts["workflow:prepare"], "node dist/src/cli.js prepare");
  assert.equal(
    packageJson.scripts["workflow:implement"],
    "node dist/src/cli.js implement"
  );
  assert.equal(packageJson.scripts["workflow:release"], "node dist/src/cli.js release");
  assert.equal(packageJson.scripts["workflow:cleanup"], "node dist/src/cli.js cleanup");
  assert.equal(packageJson.scripts["plan:issues"], "node dist/src/cli.js");
  assert.equal(packageJson.scripts["release:pr"], undefined);
});

test("README documents top-level staged commands and planner issue creation", async () => {
  const readme = await readFile("README.md", "utf8");

  assert.match(readme, /npm run workflow -- run --issue <issue-number>/);
  assert.match(readme, /release stage publishes the pull request/);
  assert.match(readme, /npm run workflow -- prepare /);
  assert.match(readme, /npm run workflow -- implement /);
  assert.match(readme, /npm run workflow -- release /);
  assert.match(readme, /npm run workflow -- --plan /);
  assert.match(readme, /npm run plan:issues -- --plan /);
  assert.doesNotMatch(readme, /legacy manual PR mode/);
  assert.doesNotMatch(readme, /npm run workflow -- --release /);
});

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

test("parses --plan, --repo, and --dry-run", () => {
  const result = parseCliArgs([
    "--plan",
    "plan.json",
    "--repo",
    "owner/name",
    "--dry-run"
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    planPath: "plan.json",
    repository: { owner: "owner", name: "name" },
    dryRun: true
  });
});

test("requires --plan", () => {
  const result = parseCliArgs(["--dry-run"]);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /--plan is required/);
});

test("rejects unsupported --release mode", () => {
  const result = parseCliArgs([
    "--release",
    "release.json"
  ]);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /Unknown option: --release/);
});

test("rejects unsupported manual pull request branch flags", () => {
  const base = parseCliArgs(["--plan", "plan.json", "--base", "main"]);
  const head = parseCliArgs(["--plan", "plan.json", "--head", "feature/a"]);

  assert.equal(base.ok, false);
  assert.match(!base.ok ? base.message : "", /Unknown option: --base/);
  assert.equal(head.ok, false);
  assert.match(!head.ok ? head.message : "", /Unknown option: --head/);
});

test("rejects unknown flags", () => {
  const result = parseCliArgs(["--plan", "plan.json", "--dry-run", "--live"]);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /Unknown option: --live/);
});

test("rejects missing option values", () => {
  const missingPlan = parseCliArgs(["--plan"]);
  const missingRepo = parseCliArgs(["--plan", "plan.json", "--repo", "--dry-run"]);

  assert.equal(missingPlan.ok, false);
  assert.match(!missingPlan.ok ? missingPlan.message : "", /--plan requires a value/);
  assert.equal(missingRepo.ok, false);
  assert.match(!missingRepo.ok ? missingRepo.message : "", /--repo requires a value/);
});

test("rejects duplicate --plan and --repo values", () => {
  const duplicatePlan = parseCliArgs([
    "--plan",
    "a.json",
    "--plan",
    "b.json",
    "--dry-run"
  ]);
  const duplicateRepo = parseCliArgs([
    "--plan",
    "plan.json",
    "--repo",
    "owner/name",
    "--repo",
    "owner/other",
    "--dry-run"
  ]);

  assert.equal(duplicatePlan.ok, false);
  assert.match(!duplicatePlan.ok ? duplicatePlan.message : "", /--plan may only/);
  assert.equal(duplicateRepo.ok, false);
  assert.match(!duplicateRepo.ok ? duplicateRepo.message : "", /--repo may only/);
});

test("rejects positional arguments", () => {
  const result = parseCliArgs(["--plan", "plan.json", "--dry-run", "extra"]);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /Unexpected positional argument/);
});

test("parses valid repository owner/name values", () => {
  assert.deepEqual(parseRepository("owner/name"), {
    owner: "owner",
    name: "name"
  });
});

test("rejects invalid repository values", () => {
  assert.throws(() => parseRepository("owner"), /owner\/name/);
  assert.throws(() => parseRepository("owner/name/extra"), /owner\/name/);
  assert.throws(() => parseRepository("/name"), /owner\/name/);
  assert.throws(() => parseRepository("owner/"), /owner\/name/);
  assert.throws(() => parseRepository("owner /name"), /owner\/name/);
});

test("dry-run prints planned issue titles and rendered bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-plan-"));
  const planPath = join(directory, "plan.json");
  await writeFile(planPath, JSON.stringify([validIssue]), "utf8");
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli(
    ["--plan", planPath, "--repo", "owner/name", "--dry-run"],
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.match(stdout.join("\n"), /Planner issue dry run: 1 issue/);
  assert.match(stdout.join("\n"), /Repository: owner\/name/);
  assert.match(stdout.join("\n"), /Issue 1: Add issue dry-run CLI/);
  assert.match(stdout.join("\n"), /## Goal/);
  assert.match(
    stdout.join("\n"),
    /Preview planned GitHub issues without mutating GitHub/
  );
  assert.match(stdout.join("\n"), /- Parse CLI arguments\./);
});

test("dry-run does not create or initialize a GitHub client", async () => {
  const stdout: string[] = [];
  const loadPlan = async (): Promise<PlannerPlanResult<PlannerPlanIssueInput[]>> => {
    return { ok: true, value: [validIssue] };
  };

  const exitCode = await runCli(["--plan", "plan.json", "--dry-run"], {
    loadPlan,
    stdout: (message) => stdout.push(message),
    createGitHubClient: () => {
      throw new Error("GitHub client should not be created during dry-run.");
    }
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.join("\n"), /Planner issue dry run: 1 issue/);
});

test("live creation converts planner issues and forwards repository", async () => {
  const client = new FakeGitHubClient([
    successfulIssue(42, validIssue.title)
  ]);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const loadPlan = async (): Promise<PlannerPlanResult<PlannerPlanIssueInput[]>> => {
    return { ok: true, value: [validIssue] };
  };

  const exitCode = await runCli(["--plan", "plan.json", "--repo", "owner/name"], {
    loadPlan,
    githubClient: client,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message)
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(client.createIssueInputs.length, 1);
  assert.deepEqual(client.createIssueInputs[0]?.repository, {
    owner: "owner",
    name: "name"
  });
  assert.equal(client.createIssueInputs[0]?.title, validIssue.title);
  assert.match(client.createIssueInputs[0]?.body ?? "", /## Goal/);
  assert.match(
    client.createIssueInputs[0]?.body ?? "",
    /Preview planned GitHub issues without mutating GitHub/
  );
});

test("live creation runs sequentially in plan order", async () => {
  const client = new FakeGitHubClient([
    successfulIssue(1, validIssue.title),
    successfulIssue(2, secondValidIssue.title)
  ]);
  const stdout: string[] = [];
  const loadPlan = async (): Promise<PlannerPlanResult<PlannerPlanIssueInput[]>> => {
    return { ok: true, value: [validIssue, secondValidIssue] };
  };

  const exitCode = await runCli(["--plan", "plan.json"], {
    loadPlan,
    githubClient: client,
    stdout: (message) => stdout.push(message)
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    client.createIssueInputs.map((input) => input.title),
    [validIssue.title, secondValidIssue.title]
  );
  assert.match(stdout.join("\n"), /Created 2 GitHub issues/);
  assert.match(stdout.join("\n"), /#1: Add issue dry-run CLI/);
  assert.match(stdout.join("\n"), /https:\/\/github.com\/owner\/name\/issues\/2/);
});

test("live creation stops on first failure and reports partial creation", async () => {
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
  const loadPlan = async (): Promise<PlannerPlanResult<PlannerPlanIssueInput[]>> => {
    return { ok: true, value: [validIssue, secondValidIssue, validIssue] };
  };

  const exitCode = await runCli(["--plan", "plan.json"], {
    loadPlan,
    githubClient: client,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message)
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.length, 0);
  assert.equal(client.createIssueInputs.length, 2);
  assert.match(
    stderr.join("\n"),
    /GitHub issue creation failed at issue 2: Add live planner issue creation/
  );
  assert.match(stderr.join("\n"), /gh lacks permission to create issues/);
  assert.match(stderr.join("\n"), /Created 1 GitHub issue before failure/);
  assert.match(stderr.join("\n"), /#1: Add issue dry-run CLI/);
});

test("invalid plan validation returns non-zero with validation messages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-plan-invalid-"));
  const planPath = join(directory, "plan.json");
  await writeFile(planPath, JSON.stringify([{ title: "Missing fields" }]), "utf8");
  const stderr: string[] = [];

  const exitCode = await runCli(["--plan", planPath, "--dry-run"], {
    stderr: (message) => stderr.push(message)
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.join("\n"), /Planner plan validation failed/);
  assert.match(stderr.join("\n"), /Issue 0 field goal is required/);
});

test("live creation validates the full plan before creating issues", async () => {
  const client = new FakeGitHubClient([successfulIssue(1, validIssue.title)]);
  const stderr: string[] = [];
  const loadPlan = async (): Promise<PlannerPlanResult<PlannerPlanIssueInput[]>> => {
    return {
      ok: false,
      errors: [{ message: "Issue 0 field goal is required." }]
    };
  };

  const exitCode = await runCli(["--plan", "plan.json"], {
    loadPlan,
    githubClient: client,
    stderr: (message) => stderr.push(message)
  });

  assert.equal(exitCode, 1);
  assert.equal(client.createIssueInputs.length, 0);
  assert.match(stderr.join("\n"), /Planner plan validation failed/);
  assert.match(stderr.join("\n"), /Issue 0 field goal is required/);
});

test("invalid --repo fails before loading the plan", async () => {
  let loadInvoked = false;
  const stderr: string[] = [];
  const loadPlan = async (): Promise<PlannerPlanResult<PlannerPlanIssueInput[]>> => {
    loadInvoked = true;
    return { ok: true, value: [validIssue] };
  };

  const exitCode = await runCli(
    ["--plan", "plan.json", "--repo", "owner/name/extra", "--dry-run"],
    {
      loadPlan,
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(loadInvoked, false);
  assert.match(stderr.join("\n"), /Repository must use exact owner\/name format/);
});

