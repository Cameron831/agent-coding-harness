import { spawn } from "node:child_process";
import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface SetupEvalWorkspaceInput {
  caseID: string;
  runID: string;
  evalParentPath: string;
  repositoryRoot?: string;
}

export interface SetupEvalWorkspaceSuccess {
  tempPath: string;
}

export interface EvalWorkspaceGitCommand {
  cwd: string;
  args: readonly string[];
}

export interface EvalWorkspaceGitRunner {
  run(command: EvalWorkspaceGitCommand): Promise<void>;
}

export interface EvalWorkspaceDependencies {
  gitRunner?: EvalWorkspaceGitRunner;
}

export async function setupEvalWorkspace(
  input: SetupEvalWorkspaceInput,
  dependencies: EvalWorkspaceDependencies = {}
): Promise<SetupEvalWorkspaceSuccess> {
  const repositoryRoot = input.repositoryRoot ?? process.cwd();
  const fixturePath = join(repositoryRoot, "evals", input.caseID, "fixture");
  const tempPath = join(input.evalParentPath, input.caseID, input.runID);

  await assertFixtureDirectory(fixturePath);
  await mkdir(join(input.evalParentPath, input.caseID), { recursive: true });
  await createNewWorkspaceDirectory(tempPath);

  try {
    await cp(fixturePath, tempPath, { recursive: true });
  } catch (cause) {
    throw new Error(
      `Unable to copy eval fixture from ${fixturePath} to ${tempPath}: ${messageFromUnknown(cause)}`
    );
  }

  const gitRunner = dependencies.gitRunner ?? new LocalEvalWorkspaceGitRunner();
  for (const args of [
    ["init"],
    ["add", "."],
    ["commit", "-m", "fixture baseline"]
  ] as const) {
    try {
      await gitRunner.run({ cwd: tempPath, args });
    } catch (cause) {
      throw new Error(
        `Unable to run git ${args.join(" ")} in eval workspace ${tempPath}: ${messageFromUnknown(cause)}`
      );
    }
  }

  return { tempPath };
}

async function assertFixtureDirectory(fixturePath: string): Promise<void> {
  let details: Awaited<ReturnType<typeof stat>>;
  try {
    details = await stat(fixturePath);
  } catch (cause) {
    throw new Error(
      `Missing eval fixture directory at ${fixturePath}: ${messageFromUnknown(cause)}`
    );
  }

  if (!details.isDirectory()) {
    throw new Error(`Eval fixture path is not a directory: ${fixturePath}`);
  }
}

async function createNewWorkspaceDirectory(tempPath: string): Promise<void> {
  try {
    await mkdir(tempPath);
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException;
    if (error.code === "EEXIST") {
      throw new Error(`Eval workspace already exists at ${tempPath}.`);
    }
    throw new Error(
      `Unable to create eval workspace at ${tempPath}: ${messageFromUnknown(cause)}`
    );
  }
}

class LocalEvalWorkspaceGitRunner implements EvalWorkspaceGitRunner {
  run(command: EvalWorkspaceGitCommand): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", [...command.args], {
        cwd: command.cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Eval Workspace",
          GIT_AUTHOR_EMAIL: "eval-workspace@example.invalid",
          GIT_COMMITTER_NAME: "Eval Workspace",
          GIT_COMMITTER_EMAIL: "eval-workspace@example.invalid"
        },
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
        if (code === 0) {
          resolve();
          return;
        }

        const output = stderr.trim() || stdout.trim() || `exit code ${code ?? 1}`;
        reject(new Error(output));
      });
    });
  }
}

function messageFromUnknown(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
