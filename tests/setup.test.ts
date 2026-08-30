import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isWorkspaceSetup, loadWorkspaceInstructions, setupWorkspace } from "../src/config/workspace-setup.js";

describe("Workspace Setup", () => {
  it("detects uninitialized workspace and initializes .rig files", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-setup-test-"));

    expect(await isWorkspaceSetup(tmpDir)).toBe(false);

    const result = await setupWorkspace(tmpDir);
    expect(result.created).toContain(".rig/config.json");
    expect(result.created).toContain(".rig/instructions.md");

    expect(await isWorkspaceSetup(tmpDir)).toBe(true);

    const configStat = await stat(path.join(tmpDir, ".rig", "config.json"));
    expect(configStat.isFile()).toBe(true);

    const instructions = await loadWorkspaceInstructions(tmpDir);
    expect(instructions).toContain("Project Instructions for RIG");
  });

  it("updates .gitignore with .rig entries if .gitignore exists", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-setup-test-"));
    const gitignore = path.join(tmpDir, ".gitignore");
    await setupWorkspace(tmpDir);

    const content = await readFile(gitignore, "utf8");
    expect(content).toContain(".rig/sessions/");
    expect(content).toContain(".rig/cache/");
  });
});
