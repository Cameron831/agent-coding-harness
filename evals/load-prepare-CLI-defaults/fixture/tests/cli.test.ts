import assert from "node:assert/strict";
import test from "node:test";
import { formatUsage, runCli } from "../src/cli.js";

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

test("unknown and missing commands print top-level usage", async () => {
  const unknownStderr: string[] = [];
  const missingStderr: string[] = [];

  const unknownExitCode = await runCli(["deploy"], {
    stderr: (message) => unknownStderr.push(message)
  });
  const missingExitCode = await runCli([], {
    stderr: (message) => missingStderr.push(message)
  });

  assert.equal(unknownExitCode, 1);
  assert.match(unknownStderr.join("\n"), /Unknown command: deploy/);
  assert.match(unknownStderr.join("\n"), /agent-workforce prepare/);
  assert.equal(missingExitCode, 1);
  assert.match(missingStderr.join("\n"), /A command is required/);
  assert.match(missingStderr.join("\n"), /agent-workforce prepare/);
});

test("top-level usage only documents the prepare fixture command", () => {
  const usage = formatUsage();

  assert.match(usage, /agent-workforce prepare/);
  assert.doesNotMatch(usage, /implement/);
  assert.doesNotMatch(usage, /release/);
  assert.doesNotMatch(usage, /--plan/);
});
