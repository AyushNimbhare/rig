import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProviderConfig, saveProviderConfig } from "../src/config/provider-setup.js";

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
});
