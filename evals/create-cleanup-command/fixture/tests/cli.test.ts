import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";

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









