import { MockModelClient } from "../model/mock-model.js";
import { OpenAIClient } from "../model/openai-client.js";
import { PiModelClient } from "../model/pi-model-client.js";
import type { ModelClient } from "../model/model-client.js";
import type { ProviderConfig } from "../config/provider-setup.js";

/**
 * Where an agent run's model output actually came from.
 *
 * - `provider` — a real remote model was configured and called.
 * - `offline`  — nothing was configured, so the scripted offline client ran.
 * - `mock`     — a provider was configured but the real client could not be built,
 *                or the caller injected a mock explicitly.
 *
 * Only `provider` means a model actually reasoned about the task. Callers that
 * report results to a user or a CI system should treat the other two as
 * "no real answer was produced".
 */
export type ModelSource = "provider" | "offline" | "mock";

/**
 * Build the model client for a run.
 *
 * This is the single place that decides whether a real provider is used, so the
 * CLI, the agent loop and the public SDK can never disagree about it.
 */
export function createModelClient(
  modelName?: string,
  providerConfig?: ProviderConfig,
): ModelClient {
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
      // Configured but unusable — a mock is still not a real answer.
      return new MockModelClient();
    }
  }

  return new PiModelClient(modelName || "gpt-4o-mini");
}

/**
 * Classify a client by origin. A client we did not create (a caller-supplied
 * implementation) is presumed to be a real provider.
 */
export function modelSourceOf(client: ModelClient): ModelSource {
  if (client instanceof PiModelClient) return "offline";
  if (client instanceof MockModelClient) return "mock";
  return "provider";
}

/** True when the run produced no genuine model output. */
export function isUnrealSource(source: ModelSource | undefined): boolean {
  return source === "offline" || source === "mock";
}
