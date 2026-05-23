import { readFile } from "node:fs/promises";
import type {
  ImplementorReleaseMetadata,
  ReleaseValidationError
} from "../../parser/release.js";
import { validateReleaseMetadata } from "../../parser/release.js";

export interface ImplementWorkflowOptions {
  promptPath: string;
  targetWorktreePath: string;
}

export type ImplementWorkflowFailureStage =
  | "prompt_load"
  | "sdk_execution"
  | "invalid_json"
  | "validation";

export interface ImplementWorkflowError {
  stage: ImplementWorkflowFailureStage;
  message: string;
  errors?: ReleaseValidationError[];
  cause?: unknown;
}

export interface ImplementWorkflowSuccess {
  release: ImplementorReleaseMetadata;
}

export type ImplementWorkflowResult =
  | {
      ok: true;
      value: ImplementWorkflowSuccess;
    }
  | {
      ok: false;
      error: ImplementWorkflowError;
    };

export type ImplementPromptLoader = (path: string) => Promise<string>;

export interface ImplementCodexTurn {
  finalResponse: string;
}

export interface ImplementCodexThread {
  run(
    input: string,
    options?: ImplementCodexTurnOptions
  ): Promise<ImplementCodexTurn>;
}

export interface ImplementCodexClient {
  startThread(options?: ImplementCodexThreadOptions): ImplementCodexThread;
}

export interface ImplementCodexThreadOptions {
  workingDirectory: string;
}

export interface ImplementCodexTurnOptions {
  outputSchema: unknown;
}

export type ImplementCodexConfigValue =
  | string
  | number
  | boolean
  | ImplementCodexConfigValue[]
  | ImplementCodexConfigObject;

export interface ImplementCodexConfigObject {
  [key: string]: ImplementCodexConfigValue;
}

export interface ImplementCodexClientOptions {
  config: ImplementCodexConfigObject;
}

export type ImplementCodexClientFactory = (
  options: ImplementCodexClientOptions
) => ImplementCodexClient | Promise<ImplementCodexClient>;

export interface ImplementWorkflowDependencies {
  loadPrompt?: ImplementPromptLoader;
  codexClient?: ImplementCodexClient;
  createCodexClient?: ImplementCodexClientFactory;
}

export const implementReleaseOutputSchema = {
  type: "object",
  properties: {
    commit_message: {
      type: "string",
      description: "Short imperative commit message"
    },
    pull_request: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short pull request title"
        },
        summary: {
          type: "string",
          description: "Concise pull request summary"
        },
        scope: {
          type: "array",
          items: {
            type: "string",
            description: "Bullet-ready description of a changed area"
          },
          minItems: 1
        },
        verification: {
          type: "array",
          items: {
            type: "string",
            description: "Bullet-ready verification result"
          },
          minItems: 1
        }
      },
      required: ["title", "summary", "scope", "verification"],
      additionalProperties: false
    }
  },
  required: ["commit_message", "pull_request"],
  additionalProperties: false
} as const;

export function buildImplementCodexConfig(): ImplementCodexConfigObject {
  return {
    model: "gpt-5.5",
    model_reasoning_effort: "xhigh",
    approval_policy: "never",
    sandbox_mode: "workspace-write",
    sandbox_workspace_write: {
      network_access: false
    },
    windows: {
      sandbox: "elevated"
    },
    show_raw_agent_reasoning: false,
    model_reasoning_summary: "concise",
    model_verbosity: "low",
    shell_environment_policy: {
      inherit: "core",
      exclude: ["*TOKEN*", "*SECRET*", "*KEY*", "GH_TOKEN"]
    }
  };
}

export async function runImplementWorkflow(
  options: ImplementWorkflowOptions,
  dependencies: ImplementWorkflowDependencies = {}
): Promise<ImplementWorkflowResult> {
  const loadPrompt = dependencies.loadPrompt ?? loadPromptFromFile;

  let prompt;
  try {
    prompt = await loadPrompt(options.promptPath);
  } catch (cause) {
    return failure("prompt_load", messageFromCause(cause), cause);
  }

  let client;
  try {
    client =
      dependencies.codexClient ??
      (await (dependencies.createCodexClient ?? createDefaultCodexClient)({
        config: buildImplementCodexConfig()
      }));

    const thread = client.startThread({
      workingDirectory: options.targetWorktreePath
    });
    const turn = await thread.run(prompt, {
      outputSchema: implementReleaseOutputSchema
    });

    return parseFinalResponse(turn.finalResponse);
  } catch (cause) {
    return failure("sdk_execution", messageFromCause(cause), cause);
  }
}

export const implementIssueWorkflow = runImplementWorkflow;

async function loadPromptFromFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function createDefaultCodexClient(
  options: ImplementCodexClientOptions
): Promise<ImplementCodexClient> {
  const { Codex } = await import("@openai/codex-sdk");
  return new Codex(options);
}

function parseFinalResponse(finalResponse: string): ImplementWorkflowResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(finalResponse);
  } catch (cause) {
    return failure(
      "invalid_json",
      "Codex final response must be valid release metadata JSON.",
      cause
    );
  }

  const validated = validateReleaseMetadata(parsed);
  if (!validated.ok) {
    return {
      ok: false,
      error: {
        stage: "validation",
        message: "Codex final response failed release metadata validation.",
        errors: validated.errors
      }
    };
  }

  return {
    ok: true,
    value: {
      release: validated.value
    }
  };
}

function failure(
  stage: ImplementWorkflowFailureStage,
  message: string,
  cause?: unknown
): ImplementWorkflowResult {
  return {
    ok: false,
    error: {
      stage,
      message,
      ...(cause !== undefined ? { cause } : {})
    }
  };
}

function messageFromCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
