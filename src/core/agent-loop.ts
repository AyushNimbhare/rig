import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ContextEngine } from "../context/context-engine.js";
import { loadProviderConfig, type ProviderConfig } from "../config/provider-setup.js";
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
        model: modelName,
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
  const workspace = path.resolve(input.workspace || process.cwd());
  const maxSteps = input.maxSteps ?? 30;
  const sessions = new SessionManager(workspace);
  const session = await sessions.create(input.task, workspace);

  const contextEngine = new ContextEngine(workspace);
  const wsContext = await contextEngine.buildInitialContext();
  const messages: ChatMessage[] = contextEngine.buildInitialMessages(input.task, wsContext);

  const registry = createDefaultToolRegistry();
  const tools = registry.toJsonSchemas();

  const safetyPolicy = new SafetyPolicy({
    autoApproveWrites: input.autoApprove,
    autoApproveVerify: input.autoApprove,
  });

  const providerConfig = await loadProviderConfig(workspace);
  const modelClient = clientOverride || createModelClient(input.model, providerConfig);

  const allObservations: ToolObservation[] = [];
  const toolsUsedSet = new Set<string>();
  const filesChangedSet = new Set<string>();

  let step = 0;

  // Helper for recording applied patches into session artifacts
  let patchCounter = 1;
  const recordPatch = async (patchContent: string): Promise<string> => {
    const patchDir = path.join(workspace, ".rig", "sessions", session.id, "patches");
    await mkdir(patchDir, { recursive: true });
    const patchFileName = `${String(patchCounter++).padStart(3, "0")}.patch`;
    const patchFilePath = path.join(patchDir, patchFileName);
    await writeFile(patchFilePath, patchContent, "utf8");
    await sessions.record(session.id, {
      type: "patch_applied",
      path: path.relative(workspace, patchFilePath),
    });
    return patchFilePath;
  };

  while (step < maxSteps) {
    step++;

    if (input.onTurn) {
      input.onTurn({ type: "model_thinking" });
    }

    const response = await modelClient.generate({
      messages,
      tools,
      temperature: 0.2,
    });

    await sessions.record(session.id, {
      type: "model_response",
      message: response.message,
      toolCallsCount: response.toolCalls.length,
      step,
    });

    // If model returns a final answer without requesting more tools
    if (response.toolCalls.length === 0) {
      await sessions.complete(session);

      if (input.onTurn) {
        input.onTurn({ type: "model_message", message: response.message });
        input.onTurn({ type: "step_completed", stepIndex: step });
      }

      return {
        status: "completed",
        message: response.message,
        sessionId: session.id,
        steps: step,
        toolsUsed: Array.from(toolsUsedSet),
        filesChanged: Array.from(filesChangedSet),
        observations: allObservations,
      };
    }

    // Append model's assistant turn with tool calls to chat history
    messages.push({
      role: "assistant",
      content: response.message || null,
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    });

    // Execute each requested tool call
    for (const toolCall of response.toolCalls) {
      toolsUsedSet.add(toolCall.name);

      if (!registry.has(toolCall.name)) {
        const observation: ToolObservation = {
          tool: toolCall.name,
          ok: false,
          result: null,
          error: `Tool '${toolCall.name}' is not registered in RIG.`,
        };
        allObservations.push(observation);
        messages.push({
          role: "tool",
          name: toolCall.name,
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: observation.error }),
        });
        continue;
      }

      const tool = registry.get(toolCall.name);

      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = (tool.args.parse(toolCall.arguments) as Record<string, unknown>) || {};
      } catch (err: any) {
        const observation: ToolObservation = {
          tool: toolCall.name,
          ok: false,
          result: null,
          error: `Invalid arguments for tool '${toolCall.name}': ${err.message}`,
        };
        allObservations.push(observation);
        messages.push({
          role: "tool",
          name: toolCall.name,
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: observation.error }),
        });
        continue;
      }

      const classification = safetyPolicy.classify(toolCall.name, parsedArgs);

      if (input.onTurn) {
        input.onTurn({
          type: "tool_called",
          tool: toolCall.name,
          args: parsedArgs,
          risk: classification.risk,
        });
      }

      // Handle user approvals for risky actions
      if (classification.requiresApproval && !input.autoApprove) {
        let approved = true;
        if (input.onApprovalRequest) {
          approved = await input.onApprovalRequest({
            tool: toolCall.name,
            arguments: parsedArgs,
            risk: classification.risk,
            reason: classification.warning,
          });
        }

        await sessions.record(session.id, {
          type: "approval_resolved",
          tool: toolCall.name,
          approved,
        });

        if (!approved) {
          const observation: ToolObservation = {
            tool: toolCall.name,
            ok: false,
            result: null,
            error: "User rejected permission to run this action.",
          };
          allObservations.push(observation);
          messages.push({
            role: "tool",
            name: toolCall.name,
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: "User rejected approval for this tool call." }),
          });
          continue;
        }
      }

      // Execute tool
      try {
        const result = await tool.execute(parsedArgs, {
          workspace,
          sessionId: session.id,
          recordPatch,
        });

        if (toolCall.name === "write_patch" && typeof parsedArgs["patch"] === "string") {
          const files = extractTargetFilesFromPatch(parsedArgs["patch"]);
          for (const f of files) filesChangedSet.add(f);
        }

        const observation: ToolObservation = {
          tool: toolCall.name,
          ok: true,
          result,
        };

        allObservations.push(observation);
        await sessions.record(session.id, {
          type: "tool_observation",
          tool: toolCall.name,
          ok: true,
          result,
        });

        if (input.onTurn) {
          input.onTurn({ type: "tool_observation", observation });
        }

        messages.push({
          role: "tool",
          name: toolCall.name,
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      } catch (err: any) {
        const observation: ToolObservation = {
          tool: toolCall.name,
          ok: false,
          result: null,
          error: err.message || String(err),
        };

        allObservations.push(observation);
        await sessions.record(session.id, {
          type: "tool_observation",
          tool: toolCall.name,
          ok: false,
          error: observation.error,
        });

        if (input.onTurn) {
          input.onTurn({ type: "tool_observation", observation });
        }

        messages.push({
          role: "tool",
          name: toolCall.name,
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: observation.error }),
        });
      }
    }

    if (input.onTurn) {
      input.onTurn({ type: "step_completed", stepIndex: step });
    }
  }

  // Max steps exceeded
  session.status = "failed";
  await sessions.complete(session);

  return {
    status: "max_steps_exceeded",
    message: `Reached maximum step limit of ${maxSteps} without completing task.`,
    sessionId: session.id,
    steps: step,
    toolsUsed: Array.from(toolsUsedSet),
    filesChanged: Array.from(filesChangedSet),
    observations: allObservations,
  };
}
