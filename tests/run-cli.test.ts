import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRunSuccess,
  parseRunCliArgs,
  runRunCli,
  type RunStageCliRunner
} from "../src/index.js";

test("run CLI parses issue option", () => {
  const result = parseRunCliArgs(["--issue", "77"]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    issueNumber: 77
  });
});

test("run CLI rejects missing issue, invalid issue, duplicate flags, missing values, unknown options, and positional arguments", () => {
  const missingIssue = parseRunCliArgs([]);
  const invalidIssue = parseRunCliArgs(["--issue", "0"]);
  const unsafeIssue = parseRunCliArgs(["--issue", "9007199254740992"]);
  const duplicate = parseRunCliArgs(["--issue", "77", "--issue", "78"]);
  const missingValue = parseRunCliArgs(["--issue"]);
  const unknown = parseRunCliArgs(["--issue", "77", "--dry-run"]);
  const positional = parseRunCliArgs(["--issue", "77", "extra"]);

  assert.equal(missingIssue.ok, false);
  assert.match(!missingIssue.ok ? missingIssue.message : "", /--issue is required/);
  assert.equal(invalidIssue.ok, false);
  assert.match(!invalidIssue.ok ? invalidIssue.message : "", /positive integer/);
  assert.equal(unsafeIssue.ok, false);
  assert.match(!unsafeIssue.ok ? unsafeIssue.message : "", /positive integer/);
  assert.equal(duplicate.ok, false);
  assert.match(!duplicate.ok ? duplicate.message : "", /--issue may only/);
  assert.equal(missingValue.ok, false);
  assert.match(!missingValue.ok ? missingValue.message : "", /requires a value/);
  assert.equal(unknown.ok, false);
  assert.match(!unknown.ok ? unknown.message : "", /Unknown option: --dry-run/);
  assert.equal(positional.ok, false);
  assert.match(
    !positional.ok ? positional.message : "",
    /Unexpected positional argument/
  );
});

test("run CLI runner returns usage failure before invoking stages", async () => {
  let invoked = false;
  const stderr: string[] = [];
  const runner: RunStageCliRunner = async () => {
    invoked = true;
    return 0;
  };

  const exitCode = await runRunCli(["--issue", "abc"], {
    stderr: (message) => stderr.push(message),
    runPrepareCli: runner,
    runImplementCli: runner,
    runReleaseCli: runner
  });

  assert.equal(exitCode, 1);
  assert.equal(invoked, false);
  assert.match(stderr.join("\n"), /--issue must be a positive integer/);
  assert.match(stderr.join("\n"), /Usage:/);
});

test("run CLI orchestrates prepare, implement, and release in order", async () => {
  const calls: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runRunCli(["--issue", "77"], {
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
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
  assert.deepEqual(stdout, [formatRunSuccess(77)]);
  assert.equal(stderr.length, 0);
});

test("run CLI forwards stdout and stderr handlers to each stage", async () => {
  const stdout = () => undefined;
  const stderr = () => undefined;
  const captured: Array<{ stdout: unknown; stderr: unknown }> = [];
  const runner: RunStageCliRunner = async (_args, options) => {
    captured.push({
      stdout: options?.stdout,
      stderr: options?.stderr
    });
    return 0;
  };

  const exitCode = await runRunCli(["--issue", "77"], {
    stdout,
    stderr,
    runPrepareCli: runner,
    runImplementCli: runner,
    runReleaseCli: runner
  });

  assert.equal(exitCode, 0);
  assert.equal(captured.length, 3);
  for (const stage of captured) {
    assert.equal(stage.stdout, stdout);
    assert.equal(stage.stderr, stderr);
  }
});

test("run CLI stops when prepare fails", async () => {
  const calls: string[] = [];
  const stdout: string[] = [];

  const exitCode = await runRunCli(["--issue", "77"], {
    stdout: (message) => stdout.push(message),
    runPrepareCli: async () => {
      calls.push("prepare");
      return 12;
    },
    runImplementCli: async () => {
      calls.push("implement");
      return 0;
    },
    runReleaseCli: async () => {
      calls.push("release");
      return 0;
    }
  });

  assert.equal(exitCode, 12);
  assert.deepEqual(calls, ["prepare"]);
  assert.equal(stdout.length, 0);
});

test("run CLI stops when implement fails", async () => {
  const calls: string[] = [];
  const stdout: string[] = [];

  const exitCode = await runRunCli(["--issue", "77"], {
    stdout: (message) => stdout.push(message),
    runPrepareCli: async () => {
      calls.push("prepare");
      return 0;
    },
    runImplementCli: async () => {
      calls.push("implement");
      return 13;
    },
    runReleaseCli: async () => {
      calls.push("release");
      return 0;
    }
  });

  assert.equal(exitCode, 13);
  assert.deepEqual(calls, ["prepare", "implement"]);
  assert.equal(stdout.length, 0);
});

test("run CLI returns release failure exit code", async () => {
  const calls: string[] = [];
  const stdout: string[] = [];

  const exitCode = await runRunCli(["--issue", "77"], {
    stdout: (message) => stdout.push(message),
    runPrepareCli: async () => {
      calls.push("prepare");
      return 0;
    },
    runImplementCli: async () => {
      calls.push("implement");
      return 0;
    },
    runReleaseCli: async () => {
      calls.push("release");
      return 14;
    }
  });

  assert.equal(exitCode, 14);
  assert.deepEqual(calls, ["prepare", "implement", "release"]);
  assert.equal(stdout.length, 0);
});
