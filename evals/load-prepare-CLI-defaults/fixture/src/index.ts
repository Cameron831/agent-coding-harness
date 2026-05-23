export type { GitHubAutomationClient } from "./github/client.js";
export { GhGitHubAutomationClient } from "./github/gh-client.js";
export { LocalGhCommandRunner } from "./github/gh-runner.js";
export type {
  GhCommandResult,
  GhCommandRunner
} from "./github/gh-runner.js";

export type { GitAutomationClient } from "./git/client.js";
export { LocalGitAutomationClient } from "./git/git-client.js";
export { LocalGitCommandRunner } from "./git/git-runner.js";
export type {
  GitCommandResult,
  GitCommandRunner
} from "./git/git-runner.js";

export {
  prepareIssueWorkflow,
  runPrepareWorkflow
} from "./workflow/prepare/prepare.js";
export {
  formatPrepareSuccess,
  formatPrepareUsage,
  parsePrepareCliArgs,
  parsePrepareRepository,
  runPrepareCli
} from "./workflow/prepare/cli-prepare.js";
export { writePrepareArtifacts } from "./workflow/prepare/artifact-writer.js";
export {
  buildPreparePrompt,
  renderPreparePrompt
} from "./workflow/prepare/prompt-builder.js";
export { prepareIssueWorkspace } from "./workflow/prepare/workspace-prep.js";

export type {
  AutomationErrorCode,
  AutomationResult,
  GitHubAutomationError,
  IssueDetails,
  IssueIdentifier,
  IssueState,
  RepositorySelection
} from "./github/types.js";
export type {
  CreateWorktreeInput,
  GetHeadInput,
  GetHeadResult,
  GitAutomationError,
  GitAutomationErrorCode,
  GitAutomationResult,
  TargetRepositoryPath,
  TargetWorktreePath,
  WorktreeDetails
} from "./git/types.js";
export type {
  PrepareArtifactWriter,
  PreparePromptRenderer,
  PrepareWorkflowDependencies,
  PrepareWorkflowError,
  PrepareWorkflowFailureStage,
  PrepareWorkflowOptions,
  PrepareWorkflowResult,
  PrepareWorkflowSettings,
  PrepareWorkflowSuccess,
  PrepareWorkspaceFunction
} from "./workflow/prepare/prepare.js";
export type {
  PrepareCliOptions,
  PrepareCliParseResult,
  PrepareWorkflowRunner,
  RunPrepareCliOptions
} from "./workflow/prepare/cli-prepare.js";
export type {
  PrepareArtifactWriterInput,
  PrepareArtifactWriterResult,
  PrepareIssueArtifact,
  PrepareRunArtifact,
  PrepareRunStatus,
  WritePrepareArtifactsInput,
  WritePrepareArtifactsResult
} from "./workflow/prepare/artifact-writer.js";
export type {
  BuildPreparePromptInput,
  PreparePromptVariant,
  RenderPreparePromptInput
} from "./workflow/prepare/prompt-builder.js";
export type {
  PreparedIssueWorkspace,
  PrepareIssueWorkspaceDependencies,
  PrepareIssueWorkspaceInput,
  PrepareIssueWorkspaceResult
} from "./workflow/prepare/workspace-prep.js";
