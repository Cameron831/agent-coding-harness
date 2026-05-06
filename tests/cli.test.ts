import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseCliArgs,
  parseRepository,
  runCli
} from "../src/cli.js";
import type {
  PlannerPlanIssueInput,
  PlannerPlanResult
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

test("--plan without --dry-run returns unsupported mode without loading the plan", async () => {
  let loadInvoked = false;
  const stderr: string[] = [];
  const loadPlan = async (): Promise<PlannerPlanResult<PlannerPlanIssueInput[]>> => {
    loadInvoked = true;
    return { ok: true, value: [validIssue] };
  };

  const exitCode = await runCli(["--plan", "plan.json"], {
    loadPlan,
    stderr: (message) => stderr.push(message)
  });

  assert.equal(exitCode, 1);
  assert.equal(loadInvoked, false);
  assert.match(stderr.join("\n"), /Live GitHub issue creation is out of scope/);
});
