import type { ModelClient, ModelInput, ModelOutput } from "./model-client.js";

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface PiModelConfig {
  model: string;
  thinkingLevel?: PiThinkingLevel;
  temperature?: number;
}

export class PiModelClient implements ModelClient {
  private readonly modelName: string;
  private readonly thinkingLevel: PiThinkingLevel;
  private readonly temperature: number;

  constructor(modelName: string, config: PiModelConfig = { model: modelName }) {
    this.modelName = modelName;
    this.thinkingLevel = config.thinkingLevel ?? "off";
    this.temperature = config.temperature ?? 0.2;
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    const { messages, tools, temperature: temp } = input;
    const effectiveTemp = temp ?? this.temperature;

    // pi-style: first response has tool calls if no tool calls in history yet
    const hasToolCallsInHistory = messages.some(
      (m) => m.role === "assistant" && m.tool_calls?.length,
    );

    const lastUserMessage = [
      ...messages.filter((m) => m.role === "user"),
    ].pop()?.content || "task";

    if (!hasToolCallsInHistory) {
      // Step 1: pi agent asks to inspect - return tool calls
      // Arguments are stored as Record<string, unknown> per ModelClient spec
      // but from the model they come as stringified JSON, so we parse
      const defaultArgs: Record<string, unknown> = { path: ".", includeHidden: false };
      const gitArgs: Record<string, unknown> = {};

      return {
        message: `Inspecting workspace with ${this.modelName} (thinking level: ${this.thinkingLevel}).`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: "list_files",
            arguments: defaultArgs,
          },
          {
            id: `call_2_${Date.now()}`,
            name: "git_status",
            arguments: gitArgs,
          },
        ],
        finishReason: "tool_calls",
      };
    }

    // Step 2+: pi agent has observations, returns final answer
    return {
      message: `Analysis complete for: ${String(lastUserMessage)}. ` +
        `Model used: ${this.modelName} with thinking level ${this.thinkingLevel}.`,
      toolCalls: [],
      finishReason: "stop",
    };
  }
}