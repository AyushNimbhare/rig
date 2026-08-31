import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fetchAvailableModels,
  loadModelConfig,
  loadProviderConfig,
  saveModelConfig,
  saveProviderConfig,
} from "../src/config/provider-setup.js";

describe("Provider Setup", () => {
  it("persists and loads provider configuration", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-provider-"));

    await saveProviderConfig(tmpDir, {
      provider: "openai",
      apiKey: "test-key",
      updatedAt: new Date().toISOString(),
    });

    await expect(loadProviderConfig(tmpDir)).resolves.toMatchObject({
      provider: "openai",
      apiKey: "test-key",
    });
    await expect(stat(path.join(tmpDir, ".rig", "provider.json"))).resolves.toBeTruthy();
    await expect(readFile(path.join(tmpDir, ".rig", "provider.json"), "utf8")).resolves.toContain("test-key");
  });

  it("allows a local Ollama provider without an API key", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-provider-local-"));

    await expect(
      saveProviderConfig(tmpDir, {
        provider: "ollama",
        apiKey: "",
        baseUrl: "http://localhost:11434/v1",
        updatedAt: new Date().toISOString(),
      }),
    ).resolves.toContain(".rig/provider.json");
  });

  it("persists the selected model separately from provider credentials", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-model-"));

    await expect(saveModelConfig(tmpDir, "gpt-4o")).resolves.toContain(".rig/model.json");
    await expect(loadModelConfig(tmpDir)).resolves.toBe("gpt-4o");
  });

  it("fetches model IDs from an OpenAI-compatible provider", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      expect(String(input)).toBe("https://api.openai.com/v1/models");
      return new Response(JSON.stringify({ data: [{ id: "provider-model" }, { id: "second-model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await expect(
        fetchAvailableModels({
          provider: "openai",
          apiKey: "test-key",
          updatedAt: new Date().toISOString(),
        }),
      ).resolves.toEqual([
        { id: "provider-model", label: "provider-model", description: "Available from the configured provider." },
        { id: "second-model", label: "second-model", description: "Available from the configured provider." },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
