import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProviderId = "openai" | "openrouter" | "ollama" | "custom";

export type ProviderConfig = {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  updatedAt: string;
};

export type AvailableModel = {
  id: string;
  label: string;
  description: string;
};

export const MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini", description: "Fast and cost-efficient OpenAI model." },
  { id: "gpt-4o", label: "GPT-4o", description: "General-purpose OpenAI model." },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", description: "Compact OpenAI coding model." },
  { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", description: "Strong reasoning and coding model." },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", description: "Fast Google model." },
  { id: "llama-3.3-70b-instruct", label: "Llama 3.3 70B", description: "Open model available through compatible providers." },
] as const;

export const PROVIDERS: Array<{ id: ProviderId; label: string; description: string; baseUrl?: string }> = [
  { id: "openai", label: "OpenAI", description: "Use OpenAI's hosted models." },
  { id: "openrouter", label: "OpenRouter", description: "Use models through OpenRouter." },
  { id: "ollama", label: "Ollama (local)", description: "Use a local Ollama OpenAI-compatible endpoint.", baseUrl: "http://localhost:11434/v1" },
  { id: "custom", label: "Custom endpoint", description: "Use any OpenAI-compatible API endpoint." },
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
  const baseUrl =
    config.baseUrl ||
    (config.provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

export async function fetchAvailableModels(config: ProviderConfig): Promise<AvailableModel[]> {
  const response = await fetch(resolveModelsEndpoint(config), {
    headers: {
      Accept: "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Model discovery failed (${response.status} ${response.statusText}).`);
  }

  const payload = (await response.json()) as { data?: unknown };
  if (!Array.isArray(payload.data)) {
    throw new Error("Model discovery returned an invalid response.");
  }

  return payload.data
    .filter((model): model is { id: string } => {
      return typeof model === "object" && model !== null && typeof (model as { id?: unknown }).id === "string";
    })
    .map((model) => ({
      id: model.id,
      label: model.id,
      description: "Available from the configured provider.",
    }));
}
