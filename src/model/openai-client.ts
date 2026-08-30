import { ModelClientError } from "../core/errors.js";
import type { ChatMessage, ModelClient, ModelInput, ModelOutput, ToolCall } from "./model-client.js";

export type OpenAIClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export class OpenAIClient implements ModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: OpenAIClientOptions = {}) {
    const isLocalOrCustom = Boolean(process.env["RIG_API_BASE_URL"] || process.env["OPENAI_BASE_URL"] || options.baseUrl);
    const apiKey =
      options.apiKey ||
      process.env["OPENAI_API_KEY"] ||
      process.env["OPENROUTER_API_KEY"] ||
      (isLocalOrCustom ? "dummy-key" : "");

    if (!apiKey) {
      throw new ModelClientError(
        "No API key provided. Set OPENAI_API_KEY or OPENROUTER_API_KEY environment variable.",
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = (
      options.baseUrl ||
      process.env["RIG_API_BASE_URL"] ||
      process.env["OPENAI_BASE_URL"] ||
      (process.env["OPENROUTER_API_KEY"] ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1")
    ).replace(/\/+$/, "");

    this.model = options.model || process.env["RIG_MODEL"] || "gpt-4o-mini";
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.baseUrl.includes("openrouter.ai")) {
      headers["HTTP-Referer"] = "https://github.com/rig-agent-harness";
      headers["X-Title"] = "RIG Agent Harness";
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
    };

    if (input.tools && input.tools.length > 0) {
      payload["tools"] = input.tools;
      payload["tool_choice"] = "auto";
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      throw new ModelClientError(`Network error reaching ${url}: ${err.message}`);
    }

    if (!res.ok) {
      const errorText = await res.text();
      let parsedError: string;
      try {
        const json = JSON.parse(errorText);
        parsedError = json.error?.message || json.message || errorText;
      } catch {
        parsedError = errorText;
      }
      throw new ModelClientError(`API error (${res.status}): ${parsedError}`, res.status);
    }

    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new ModelClientError("Empty response returned from model API.");
    }

    const messageContent = choice.message?.content || "";
    const rawToolCalls = choice.message?.tool_calls || [];

    const toolCalls: ToolCall[] = rawToolCalls.map((tc: any, idx: number) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments || "{}");
      } catch {
        parsedArgs = { raw: tc.function.arguments };
      }

      return {
        id: tc.id || `call_${idx}`,
        name: tc.function.name,
        arguments: parsedArgs,
      };
    });

    return {
      message: messageContent,
      toolCalls,
      finishReason: choice.finish_reason || "stop",
    };
  }
}
