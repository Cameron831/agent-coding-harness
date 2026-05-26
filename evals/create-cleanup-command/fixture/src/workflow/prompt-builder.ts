import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IssueDetails } from "../github/types.js";

export type ImplementPromptVariant = "standard" | "with-subagents";

export interface RenderImplementPromptInput {
  issue: IssueDetails;
  variant?: ImplementPromptVariant;
  promptsDirectory?: string;
}

export type BuildImplementPromptInput = RenderImplementPromptInput;

export interface RenderFeedbackPromptInput {
  issue: IssueDetails;
  promptsDirectory?: string;
  feedback: string;
  releaseJson: string;
}

export type BuildFeedbackPromptInput = RenderFeedbackPromptInput;

const DEFAULT_PROMPTS_DIRECTORY = join("prompts", "implement");

const templateFileByVariant: Record<ImplementPromptVariant, string> = {
  standard: "implement-prompt.md",
  "with-subagents": "implement-with-subagents-prompt.md"
};

const FEEDBACK_TEMPLATE_FILE = "implement-feedback-prompt.md";

export async function renderImplementPrompt(
  input: RenderImplementPromptInput
): Promise<string> {
  const variant = input.variant ?? "standard";
  const promptsDirectory =
    input.promptsDirectory ?? DEFAULT_PROMPTS_DIRECTORY;
  const templatePath = join(promptsDirectory, templateFileByVariant[variant]);
  const template = await readFile(templatePath, "utf8");
  return renderIssueTemplate(template, input.issue);
}

export const buildImplementPrompt = renderImplementPrompt;

export async function renderFeedbackPrompt(
  input: RenderFeedbackPromptInput
): Promise<string> {
  const promptsDirectory =
    input.promptsDirectory ?? DEFAULT_PROMPTS_DIRECTORY;
  const templatePath = join(promptsDirectory, FEEDBACK_TEMPLATE_FILE);
  const template = await readFile(templatePath, "utf8");
  return renderIssueTemplate(template, input.issue)
    .replaceAll("{{feedback}}", input.feedback)
    .replaceAll("{{releaseJson}}", input.releaseJson);
}

export const buildFeedbackPrompt = renderFeedbackPrompt;

function renderIssueTemplate(template: string, issue: IssueDetails): string {
  return template
    .replaceAll("{{number}}", String(issue.issueNumber))
    .replaceAll("{{title}}", issue.title)
    .replaceAll("{{body}}", issue.body ?? "");
}
