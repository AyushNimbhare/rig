import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ContextEngine } from "../context/context-engine.js";
import { loadModelConfig, loadProviderConfig, type ProviderConfig } from "../config/provider-setup.js";
import { MockModelClient } from "../model/mock-model.js";
import type { ChatMessage, ModelClient } from "../model/model-client.js";
import { OpenAIClient } from "../model/openai-client.js";
import { SafetyPolicy } from "../safety/policy.js";
import { gitDiff, gitStatus } from "../tools/git.js";
import { listFiles, readFileTool, searchText } from "../tools/read-only.js";
import { ToolRegistry } from "../tools/registry.js";
import { runShellTool } from "../tools/run-shell.js";
import { extractTargetFilesFromPatch, writePatchTool } from "../tools/write-patch.js";
import type { AgentInput, AgentResult, ToolObservation } from "./agent-types.js";
import { SessionManager } from "./session.js";
import { runPiAgentLoop } from "./agent-loop-adapter.js";

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(listFiles);
  registry.register(readFileTool);
  registry.register(searchText);
  registry.register(gitStatus);
  registry.register(gitDiff);
  registry.register(writePatchTool);
  registry.register(runShellTool);
  return registry;
}

export function createModelClient(modelName?: string, providerConfig?: ProviderConfig): ModelClient {
  const providerBaseUrl =
    providerConfig?.baseUrl ||
    (providerConfig?.provider === "openrouter" ? "https://openrouter.ai/api/v1" : undefined);
  const hasKey = Boolean(
    providerConfig?.apiKey ||
    process.env["OPENAI_API_KEY"] ||
      process.env["OPENROUTER_API_KEY"] ||
      process.env["RIG_API_BASE_URL"] ||
      process.env["OPENAI_BASE_URL"],
  );

  if (hasKey) {
    try {
      return new OpenAIClient({
        model: modelName || providerConfig?.model,
        apiKey: providerConfig?.apiKey,
        baseUrl: providerBaseUrl,
      });
    } catch {
      return new MockModelClient();
    }
  }

  return new MockModelClient();
}

export async function runAgentLoop(input: AgentInput, clientOverride?: ModelClient): Promise<AgentResult> {
  // Use pi's agent loop adapter for the core thinking/reasoning
  // This gives us pi's agent reasoning while keeping RIG's UI and safety
  return await runPiAgentLoop(input, clientOverride);
}