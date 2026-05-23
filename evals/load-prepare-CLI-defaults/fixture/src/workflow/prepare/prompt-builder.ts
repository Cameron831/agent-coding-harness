import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IssueDetails } from "../../github/types.js";

export type PreparePromptVariant = "standard" | "with-subagents";

export interface RenderPreparePromptInput {
  issue: IssueDetails;
  variant?: PreparePromptVariant;
  promptsDirectory?: string;
}

export type BuildPreparePromptInput = RenderPreparePromptInput;

const DEFAULT_PROMPTS_DIRECTORY = join("prompts", "implement");

const templateFileByVariant: Record<PreparePromptVariant, string> = {
  standard: "implement-prompt.md",
  "with-subagents": "implement-with-subagents-prompt.md"
};

export async function renderPreparePrompt(
  input: RenderPreparePromptInput
): Promise<string> {
  const variant = input.variant ?? "standard";
  const promptsDirectory =
    input.promptsDirectory ?? DEFAULT_PROMPTS_DIRECTORY;
  const templatePath = join(promptsDirectory, templateFileByVariant[variant]);
  const template = await readFile(templatePath, "utf8");

  return renderIssueTemplate(template, input.issue);
}

export const buildPreparePrompt = renderPreparePrompt;

function renderIssueTemplate(template: string, issue: IssueDetails): string {
  return template
    .replaceAll("{{number}}", String(issue.issueNumber))
    .replaceAll("{{title}}", issue.title)
    .replaceAll("{{body}}", issue.body ?? "");
}
