import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type WorkspaceSetupResult = {
  created: string[];
  updatedGitignore: boolean;
};

export async function isWorkspaceSetup(workspace: string): Promise<boolean> {
  try {
    const s = await stat(path.join(workspace, ".rig"));
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function setupWorkspace(workspace: string): Promise<WorkspaceSetupResult> {
  const created: string[] = [];
  const rigDir = path.join(workspace, ".rig");
  const sessionsDir = path.join(rigDir, "sessions");
  const cacheDir = path.join(rigDir, "cache");

  // 1. Create directories
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  created.push(".rig/", ".rig/sessions/", ".rig/cache/");

  // 2. Create default config.json
  const configPath = path.join(rigDir, "config.json");
  try {
    await stat(configPath);
  } catch {
    const defaultConfig = {
      model: "gpt-4o-mini",
      approvals: {
        patches: true,
        shellCommands: true,
        network: true,
      },
      limits: {
        maxSteps: 30,
        toolTimeoutMs: 60000,
      },
    };
    await writeFile(configPath, JSON.stringify(defaultConfig, null, 2) + "\n", "utf8");
    created.push(".rig/config.json");
  }

  // 3. Create instructions.md template
  const instructionsPath = path.join(rigDir, "instructions.md");
  try {
    await stat(instructionsPath);
  } catch {
    const defaultInstructions = `# Project Instructions for RIG

Add repository-specific guidance for RIG here:
- Coding conventions and architecture guidelines.
- Preferred test command (e.g. \`npm test\`, \`vitest\`, \`pytest\`).
- Important files or directories to preserve.
`;
    await writeFile(instructionsPath, defaultInstructions, "utf8");
    created.push(".rig/instructions.md");
  }

  // 4. Update .gitignore if present or if in a git repository
  let updatedGitignore = false;
  const gitignorePath = path.join(workspace, ".gitignore");
  try {
    let content = "";
    try {
      content = await readFile(gitignorePath, "utf8");
    } catch {
      content = "";
    }

    const entriesToAdd: string[] = [];
    if (!content.includes(".rig/sessions")) entriesToAdd.push(".rig/sessions/");
    if (!content.includes(".rig/cache")) entriesToAdd.push(".rig/cache/");
    if (!content.includes(".rig/provider.json")) entriesToAdd.push(".rig/provider.json");
    if (!content.includes(".rig/model.json")) entriesToAdd.push(".rig/model.json");
    if (!content.includes(".rig/config.json")) entriesToAdd.push(".rig/config.json");

    if (entriesToAdd.length > 0) {
      const appendText = (content.length > 0 && !content.endsWith("\n") ? "\n" : "") + entriesToAdd.join("\n") + "\n";
      await appendFile(gitignorePath, appendText, "utf8");
      updatedGitignore = true;
    }
  } catch {
    // Ignore .gitignore update failures
  }

  return {
    created,
    updatedGitignore,
  };
}

export async function loadWorkspaceInstructions(workspace: string): Promise<string | undefined> {
  try {
    const instructionsPath = path.join(workspace, ".rig", "instructions.md");
    const content = await readFile(instructionsPath, "utf8");
    return content.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function loadWorkspaceConfig(workspace: string): Promise<Record<string, unknown> | undefined> {
  try {
    const configPath = path.join(workspace, ".rig", "config.json");
    const content = await readFile(configPath, "utf8");
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}
