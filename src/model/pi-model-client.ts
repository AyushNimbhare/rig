import type { ModelClient, ModelInput, ModelOutput } from "./model-client.js";

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface PiModelConfig {
  model: string;
  thinkingLevel?: PiThinkingLevel;
  temperature?: number;
}

/**
 * Marker prefix so offline output can never be mistaken for a real model reply.
 * Asserted against in tests — keep it stable.
 */
export const OFFLINE_MARKER = "[offline fallback]";

const OFFLINE_STEP_ONE =
  `${OFFLINE_MARKER} No model provider is configured, so no model was called. ` +
  `RIG is running its built-in scripted fallback to exercise the tool pipeline.`;

function offlineNotice(modelName: string, thinkingLevel: PiThinkingLevel): string {
  return (
    `${OFFLINE_MARKER} No model provider is configured, so no model was called and your ` +
    `request was not analysed. The tool calls above really executed, but this summary is a ` +
    `deterministic placeholder.\n\n` +
    `RIG would have sent this task to "${modelName}" (thinking level: ${thinkingLevel}). ` +
    `Configure a provider with /provider, or set OPENAI_API_KEY, OPENROUTER_API_KEY or ` +
    `RIG_API_BASE_URL, then retry.`
  );
}

/**
 * Deterministic offline stand-in for a real model client.
 *
 * This exists so the harness, safety policy and tool pipeline can be exercised without
 * credentials. It never contacts a network and never reasons about the task — every
 * message it returns is labelled with {@link OFFLINE_MARKER} so callers and users cannot
 * mistake it for a genuine model response.
 */
export class PiModelClient implements ModelClient {
  private readonly modelName: string;
  private readonly thinkingLevel: PiThinkingLevel;

  constructor(modelName: string, config: PiModelConfig = { model: modelName }) {
    this.modelName = modelName;
    this.thinkingLevel = config.thinkingLevel ?? "off";
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    const { messages } = input;

    // Step 1: scripted "inspect the workspace" turn so the real tools run.
    const hasToolCallsInHistory = messages.some(
      (m) => m.role === "assistant" && m.tool_calls?.length,
    );

    if (!hasToolCallsInHistory) {
      return {
        message: OFFLINE_STEP_ONE,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: "list_files",
            arguments: { path: ".", includeHidden: false },
          },
          {
            id: `call_2_${Date.now()}`,
            name: "git_status",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      };
    }

    // Step 2+: no further reasoning is available offline.
    const lastUserMessage =
      [...messages.filter((m) => m.role === "user")].pop()?.content || "task";

    return {
      message: `${offlineNotice(this.modelName, this.thinkingLevel)}\n\nTask received: ${String(lastUserMessage)}`,
      toolCalls: [],
      finishReason: "stop",
    };
  }
}
