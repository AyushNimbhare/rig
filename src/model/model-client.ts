export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type ToolJsonSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ModelInput = {
  messages: ChatMessage[];
  tools?: ToolJsonSchema[];
  temperature?: number;
};

export type ModelOutput = {
  message: string;
  toolCalls: ToolCall[];
  finishReason?: string;
};

export interface ModelClient {
  generate(input: ModelInput): Promise<ModelOutput>;
}
