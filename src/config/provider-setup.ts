import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProviderId = "openai" | "openrouter" | "ollama" | "anthropic" | "custom";

export type ApiCompat = "openai" | "anthropic";

export type ProviderConfig = {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  apiCompat?: ApiCompat;
  model?: string;
  updatedAt: string;
};

export type AvailableModel = {
  id: string;
  label: string;
  description: string;
};

/**
 * @deprecated Hard-coded model list removed for realtime data.
 * Use fetchAvailableModels() with a configured provider instead.
 * Kept as empty for backwards compat — will be removed.
 */
export const MODELS: AvailableModel[] = [];

export const PROVIDERS: Array<{ id: ProviderId; label: string; description: string; baseUrl?: string; apiCompat?: ApiCompat }> = [
  { id: "openai", label: "OpenAI", description: "Use OpenAI's hosted models.", apiCompat: "openai" },
  { id: "openrouter", label: "OpenRouter", description: "Use models through OpenRouter.", apiCompat: "openai" },
  { id: "anthropic", label: "Anthropic", description: "Use Anthropic Claude directly.", apiCompat: "anthropic", baseUrl: "https://api.anthropic.com" },
  { id: "ollama", label: "Ollama (local)", description: "Use a local Ollama OpenAI-compatible endpoint.", baseUrl: "http://localhost:11434/v1", apiCompat: "openai" },
  { id: "custom", label: "Custom / Third-party", description: "Any OpenAI or Anthropic-compatible endpoint.", apiCompat: "openai" },
];

function providerConfigPath(workspace: string): string {
  return path.join(workspace, ".rig", "provider.json");
}

export async function saveProviderConfig(workspace: string, config: ProviderConfig): Promise<string> {
  if (!config.apiKey.trim() && config.provider !== "ollama") {
    throw new Error("An API key is required for this provider.");
  }
  const rigDir = path.join(workspace, ".rig");
  await mkdir(rigDir, { recursive: true });
  const filePath = providerConfigPath(workspace);
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
  return filePath;
}

export async function saveModelConfig(workspace: string, model: string): Promise<string> {
  const rigDir = path.join(workspace, ".rig");
  await mkdir(rigDir, { recursive: true });
  const filePath = path.join(rigDir, "model.json");
  await writeFile(
    filePath,
    `${JSON.stringify({ model, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(filePath, 0o600);
  return filePath;
}

export async function loadModelConfig(workspace: string): Promise<string | undefined> {
  try {
    const content = await readFile(path.join(workspace, ".rig", "model.json"), "utf8");
    const parsed = JSON.parse(content) as { model?: unknown };
    return typeof parsed.model === "string" && parsed.model.length > 0 ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

export async function loadProviderConfig(workspace: string): Promise<ProviderConfig | undefined> {
  try {
    const content = await readFile(providerConfigPath(workspace), "utf8");
    const parsed = JSON.parse(content) as ProviderConfig;
    if (!parsed.provider || typeof parsed.apiKey !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function resolveModelsEndpoint(config: ProviderConfig): string {
  const compat = config.apiCompat || (config.provider === "anthropic" ? "anthropic" : "openai");
  if (compat === "anthropic") {
    const baseUrl = config.baseUrl || "https://api.anthropic.com";
    return `${baseUrl.replace(/\/+$/, "")}/v1/models`;
  }
  const baseUrl =
    config.baseUrl ||
    (config.provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function buildAuthHeaders(config: ProviderConfig): Record<string, string> {
  const compat = config.apiCompat || (config.provider === "anthropic" ? "anthropic" : "openai");
  if (compat === "anthropic") {
    return {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}

export async function fetchAvailableModels(config: ProviderConfig): Promise<AvailableModel[]> {
  const response = await fetch(resolveModelsEndpoint(config), {
    headers: {
      Accept: "application/json",
      ...buildAuthHeaders(config),
    },
  });

  if (!response.ok) {
    throw new Error(`Model discovery failed (${response.status} ${response.statusText}).`);
  }

  const payload = (await response.json()) as { data?: unknown; models?: unknown };
  const raw = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : null;
  if (!raw) {
    throw new Error("Model discovery returned an invalid response.");
  }

  return raw
    .filter((model): model is { id: string } & Record<string, unknown> => {
      return typeof model === "object" && model !== null && typeof (model as { id?: unknown }).id === "string";
    })
    .map((model) => {
      const displayName = (model as { display_name?: unknown }).display_name;
      return {
        id: model.id,
        label: typeof displayName === "string" ? `${model.id} — ${displayName}` : model.id,
        description: "Available from the configured provider.",
      };
    });
}
