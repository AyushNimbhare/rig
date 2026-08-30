import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProviderId = "openai" | "openrouter" | "ollama" | "custom";

export type ProviderConfig = {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  updatedAt: string;
};

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
