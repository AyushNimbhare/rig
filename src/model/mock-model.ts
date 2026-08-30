import type { ModelClient, ModelInput, ModelOutput } from "./model-client.js";

export class MockModelClient implements ModelClient {
  private stepCount = 0;

  constructor(
    private readonly customResponses?: Array<ModelOutput | ((input: ModelInput) => ModelOutput)>,
  ) {}

  async generate(input: ModelInput): Promise<ModelOutput> {
    if (this.customResponses && this.customResponses.length > 0) {
      const resp = this.customResponses[this.stepCount % this.customResponses.length];
      this.stepCount++;
      return typeof resp === "function" ? resp(input) : resp;
    }

    // Default mock behavior for testing:
    // Step 1: inspect repo
    // Step 2: return final answer
    const hasObservations = input.messages.some((m) => m.role === "tool");
    const lastUserMessage = [...input.messages].reverse().find((m) => m.role === "user")?.content || "task";

    if (!hasObservations) {
      return {
        message: "Inspecting workspace...",
        toolCalls: [
          { id: "call_git_status", name: "git_status", arguments: {} },
          { id: "call_list_files", name: "list_files", arguments: { path: ".", includeHidden: false } },
        ],
        finishReason: "tool_calls",
      };
    }

    return {
      message: `Completed analysis for: ${lastUserMessage}`,
      toolCalls: [],
      finishReason: "stop",
    };
  }
}
