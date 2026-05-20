import { spawn } from "node:child_process";

export interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitCommandRunner {
  run(args: readonly string[]): Promise<GitCommandResult>;
}

export class LocalGitCommandRunner implements GitCommandRunner {
  run(args: readonly string[]): Promise<GitCommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", [...args], {
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
