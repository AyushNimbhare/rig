// Core Agent Engine & Types
export { runAgentLoop, createDefaultToolRegistry, createModelClient } from "./core/agent-loop.js";
export type {
  AgentInput,
  AgentResult,
  AgentStepEvent,
  ApprovalRequest,
  RiskLevel,
  ToolObservation,
} from "./core/agent-types.js";
export { SessionManager } from "./core/session.js";
export type { Session } from "./core/session.js";
export type { SessionEvent } from "./core/events.js";
export * from "./core/errors.js";

// Model Clients & Interfaces
export type {
  ModelClient,
  ModelInput,
  ModelOutput,
  ChatMessage,
  ToolCall,
  ToolJsonSchema,
} from "./model/model-client.js";
export { OpenAIClient } from "./model/openai-client.js";
export type { OpenAIClientOptions } from "./model/openai-client.js";
export { MockModelClient } from "./model/mock-model.js";

// Safety & Policy
export { SafetyPolicy } from "./safety/policy.js";
export type { RiskClassification } from "./safety/policy.js";

// Tools System
export { ToolRegistry } from "./tools/registry.js";
export type { Tool, ToolContext } from "./tools/tool-types.js";
export { listFiles, readFileTool, searchText } from "./tools/read-only.js";
export { gitStatus, gitDiff } from "./tools/git.js";
export { writePatchTool, extractTargetFilesFromPatch, applyUnifiedDiff } from "./tools/write-patch.js";
export { runShellTool } from "./tools/run-shell.js";

// Workspace + Plugin Setup
export { setupWorkspace, isWorkspaceSetup, loadWorkspaceConfig, loadWorkspaceInstructions } from "./config/workspace-setup.js";
export {
  MCU_DEFAULTS,
  getMcuProfileSummary,
  initializeMcuWorkspace,
  isMcuWorkspaceSetup,
  listMcuProfiles,
  loadMcuConfig,
  resolveMcuBoard,
  resolveMcuTemplate,
  setupMcuWorkspace,
} from "./config/mcu-setup.js";
export type { McuProfile, McuSetupOptions, McuSetupResult, McuTemplate } from "./config/mcu-setup.js";
export { PROVIDERS, loadProviderConfig, saveProviderConfig } from "./config/provider-setup.js";
export type { ProviderConfig, ProviderId } from "./config/provider-setup.js";

// Context Engine
export { ContextEngine } from "./context/context-engine.js";
export type { WorkspaceContext } from "./context/context-engine.js";
