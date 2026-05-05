import { spawn } from "node:child_process";

export interface GhCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GhCommandRunner {
  run(args: readonly string[]): Promise<GhCommandResult>;
}

export class LocalGhCommandRunner implements GhCommandRunner {
  run(args: readonly string[]): Promise<GhCommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn("gh", [...args], {
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr
        });
      });
    });
  }
}
