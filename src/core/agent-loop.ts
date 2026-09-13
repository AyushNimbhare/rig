import type { ModelClient } from "../model/model-client.js";
import type { AgentInput, AgentResult } from "./agent-types.js";
import { runPiAgentLoop } from "./agent-loop-adapter.js";

export { createDefaultToolRegistry } from "../tools/default-registry.js";
export { createModelClient, isUnrealSource, modelSourceOf } from "./model-factory.js";
export type { ModelSource } from "./model-factory.js";

export async function runAgentLoop(
  input: AgentInput,
  clientOverride?: ModelClient,
): Promise<AgentResult> {
  // The adapter carries the core inspect -> plan -> act -> observe loop.
  // RIG keeps ownership of the UI, the tool registry and the safety policy.
  return await runPiAgentLoop(input, clientOverride);
}
