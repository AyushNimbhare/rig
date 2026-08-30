import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadWorkspaceInstructions } from "../config/workspace-setup.js";
import type { ChatMessage } from "../model/model-client.js";

const exec = promisify(execFile);

export type WorkspaceContext = {
  workspace: string;
  gitBranch?: string;
  gitClean?: boolean;
  topFiles: string[];
  instructions?: string;
};

export class ContextEngine {
  constructor(private readonly workspace: string) {}

  async buildInitialContext(): Promise<WorkspaceContext> {
    let gitBranch: string | undefined;
    let gitClean = true;

    try {
      const res = await exec("git", ["status", "--short", "--branch"], { cwd: this.workspace });
      const lines = res.stdout.trim().split("\n");
      const branchHeader = lines[0];
      if (branchHeader?.startsWith("## ")) {
        gitBranch = branchHeader.replace("## ", "").split("...")[0];
      }
      gitClean = lines.length <= 1 || !lines.some((l) => l && !l.startsWith("##"));
    } catch {
      // not a git repository
    }

    let topFiles: string[] = [];
    try {
      const entries = await readdir(this.workspace, { withFileTypes: true });
      topFiles = entries
        .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist")
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
    } catch {
      topFiles = [];
    }

    const instructions = await loadWorkspaceInstructions(this.workspace);

    return {
      workspace: this.workspace,
      gitBranch,
      gitClean,
      topFiles,
      instructions,
    };
  }

  buildSystemPrompt(context: WorkspaceContext): string {
    const wsName = path.basename(context.workspace);
    const gitInfo = context.gitBranch
      ? `Git branch: ${context.gitBranch} (${context.gitClean ? "clean" : "dirty worktree"})`
      : "Not a git repository";

    const customInstructions = context.instructions
      ? `\n# Custom Repository Guidance (.rig/instructions.md)\n${context.instructions}\n`
      : "";

    return `You are RIG, a terminal-native autonomous AI coding agent operating inside a local software project.

# Environment
- Workspace root: ${context.workspace} (${wsName})
- ${gitInfo}
- Top-level files/dirs: ${context.topFiles.join(", ") || "empty"}
${customInstructions}
# Behavioral Contract & Rules
1. Inspect before acting: Always read or search relevant files first before proposing changes.
2. Structure edits with write_patch: When editing files, output standard unified diff patches with '--- a/<path>' and '+++ b/<path>' headers.
3. Verify your work: Run tests, typechecks, or build scripts using the 'run_shell' tool after applying changes.
4. Minimal focused changes: Only modify what is strictly necessary for the task. Avoid unrelated refactors or formatting changes.
5. Path safety: All file paths must be relative to the workspace root. Do not attempt to access files outside the workspace.
6. Provide concise final answers: When the task is complete, summarize what files were changed, what checks were run, and any relevant notes.`;
  }

  buildInitialMessages(task: string, context: WorkspaceContext): ChatMessage[] {
    return [
      {
        role: "system",
        content: this.buildSystemPrompt(context),
      },
      {
        role: "user",
        content: task,
      },
    ];
  }
}
