import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isMcuWorkspaceSetup, loadMcuConfig, setupMcuWorkspace } from "../src/config/mcu-setup.js";

describe("MCU Setup", () => {
  it("detects when an MCU scaffold has been initialized", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-mcu-detect-"));

    expect(await isMcuWorkspaceSetup(tmpDir)).toBe(false);

    await setupMcuWorkspace({
      workspace: tmpDir,
      profile: "esp32-arduino",
      board: "esp32dev",
      template: "minimal",
    });

    expect(await isMcuWorkspaceSetup(tmpDir)).toBe(true);
  });

  it("scaffolds an ESP32 Arduino project", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-mcu-setup-"));

    const result = await setupMcuWorkspace({
      workspace: tmpDir,
      profile: "esp32-arduino",
      board: "esp32dev",
      template: "minimal",
    });

    expect(result.created).toContain(".rig/plugins/mcu.json");
    expect(result.created).toContain("platformio.ini");
    expect(result.created).toContain("src/main.cpp");

    const config = await loadMcuConfig(tmpDir);
    expect(config).toMatchObject({
      enabled: true,
      profile: "esp32-arduino",
      board: "esp32dev",
      template: "minimal",
    });
  });

  it("does not overwrite existing files unless overwrite is enabled", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-mcu-overwrite-"));
    const existingFile = path.join(tmpDir, "platformio.ini");
    await writeFile(existingFile, "existing-config\n", "utf8");

    const result = await setupMcuWorkspace({
      workspace: tmpDir,
      profile: "esp32-arduino",
      board: "esp32dev",
      overwrite: false,
    });

    expect(result.created).not.toContain("platformio.ini");
  });
});
