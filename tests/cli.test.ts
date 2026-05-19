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
  ImplementorReleaseMetadata,
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

type ManualPrRunCliOptions = NonNullable<Parameters<typeof runCli>[1]>;

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
  assert.match(unknownStderr.join("\n"), /agent-workforce prepare/);
  assert.match(unknownStderr.join("\n"), /agent-workforce release/);

  assert.equal(missingExitCode, 1);
  assert.match(missingStderr.join("\n"), /--plan is required/);
  assert.match(missingStderr.join("\n"), /agent-workforce implement/);
});

test("top-level usage lists staged commands without workflow-local options", () => {
  const usage = formatUsage();

  assert.match(usage, /agent-workforce prepare \[prepare options\]/);
  assert.match(usage, /agent-workforce implement \[implement options\]/);
  assert.match(usage, /agent-workforce release \[release publish options\]/);
  assert.match(usage, /agent-workforce cleanup \[cleanup options\]/);
  assert.match(usage, /manual PR from release\.json/);
  assert.doesNotMatch(usage, /--target-repo/);
  assert.doesNotMatch(usage, /--worktree-parent/);
});

test("package scripts expose top-level staged workflow commands", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.equal(packageJson.scripts.workflow, "node dist/src/cli.js");
  assert.equal(packageJson.scripts["workflow:prepare"], "node dist/src/cli.js prepare");
  assert.equal(
    packageJson.scripts["workflow:implement"],
    "node dist/src/cli.js implement"
  );
  assert.equal(packageJson.scripts["workflow:release"], "node dist/src/cli.js release");
  assert.equal(packageJson.scripts["workflow:cleanup"], "node dist/src/cli.js cleanup");
  assert.equal(packageJson.scripts["plan:issues"], "node dist/src/cli.js");
  assert.equal(packageJson.scripts["release:pr"], "node dist/src/cli.js");
});

test("README documents top-level staged commands and qualifies legacy release mode", async () => {
  const readme = await readFile("README.md", "utf8");

  assert.match(readme, /npm run workflow -- prepare /);
  assert.match(readme, /npm run workflow -- implement /);
  assert.match(readme, /npm run workflow -- release /);
  assert.match(readme, /legacy manual PR mode/);
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

test("parses --release with optional repository, base, head, and dry-run", () => {
  const result = parseCliArgs([
    "--release",
    "release.json",
    "--repo",
    "owner/name",
    "--base",
    "develop",
    "--head",
    "feature/manual-pr-cli",
    "--dry-run"
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    releasePath: "release.json",
    repository: { owner: "owner", name: "name" },
    base: "develop",
    head: "feature/manual-pr-cli",
    dryRun: true
  });
});

test("requires --plan", () => {
  const result = parseCliArgs(["--dry-run"]);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /--plan is required/);
});

test("rejects conflicting --plan and --release modes", () => {
  const result = parseCliArgs([
    "--plan",
    "plan.json",
    "--release",
    "release.json"
  ]);

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /--plan and --release/);
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

test("rejects duplicate release pull request option values", () => {
  const duplicateRelease = parseCliArgs([
    "--release",
    "a.json",
    "--release",
    "b.json",
    "--dry-run"
  ]);
  const duplicateBase = parseCliArgs([
    "--release",
    "release.json",
    "--base",
    "main",
    "--base",
    "develop"
  ]);
  const duplicateHead = parseCliArgs([
    "--release",
    "release.json",
    "--head",
    "feature/a",
    "--head",
    "feature/b"
  ]);

  assert.equal(duplicateRelease.ok, false);
  assert.match(!duplicateRelease.ok ? duplicateRelease.message : "", /--release may only/);
  assert.equal(duplicateBase.ok, false);
  assert.match(!duplicateBase.ok ? duplicateBase.message : "", /--base may only/);
  assert.equal(duplicateHead.ok, false);
  assert.match(!duplicateHead.ok ? duplicateHead.message : "", /--head may only/);
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

test("release mode wires the default git branch resolver when head is omitted", async () => {
  const stdout: string[] = [];
  const gitArgs: string[][] = [];
  const options: ManualPrRunCliOptions = {
    loadRelease: async () => ({ ok: true, value: validRelease }),
    stdout: (message) => stdout.push(message),
    gitRunner: {
      async run(args) {
        gitArgs.push([...args]);
        return {
          exitCode: 0,
          stdout: "feature/from-git\n",
          stderr: ""
        };
      }
    },
    createGitHubClient: () => {
      throw new Error("GitHub client should not be created during PR dry-run.");
    }
  };

  const exitCode = await runCli(
    ["--release", "release.json", "--dry-run"],
    options
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(gitArgs, [["branch", "--show-current"]]);
  assert.match(stdout.join("\n"), /Base: main/);
  assert.match(stdout.join("\n"), /Head: feature\/from-git/);
});

test("release mode routes explicit head without default git branch resolution", async () => {
  const stdout: string[] = [];
  const options: ManualPrRunCliOptions = {
    loadRelease: async () => ({ ok: true, value: validRelease }),
    gitRunner: {
      async run() {
        throw new Error("git should not be used when --head is set.");
      }
    },
    createGitHubClient: () => {
      throw new Error("GitHub client should not be created during PR dry-run.");
    },
    stdout: (message) => stdout.push(message)
  };

  const exitCode = await runCli(
    [
      "--release",
      "release.json",
      "--repo",
      "owner/name",
      "--base",
      "develop",
      "--head",
      "feature/explicit-head",
      "--dry-run"
    ],
    options
  );

  assert.equal(exitCode, 0);
  assert.match(stdout.join("\n"), /Repository: owner\/name/);
  assert.match(stdout.join("\n"), /Base: develop/);
  assert.match(stdout.join("\n"), /Head: feature\/explicit-head/);
});

