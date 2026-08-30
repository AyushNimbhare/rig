import { execFile } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Tool } from "./tool-types.js";

const exec = promisify(execFile);

export function safePath(workspace: string, relative: string): string {
  const root = path.resolve(workspace);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path '${relative}' is outside workspace boundary`);
  }
  return target;
}

export function extractTargetFilesFromPatch(patch: string): string[] {
  const files: string[] = [];
  const lines = patch.split("\n");
  for (const line of lines) {
    if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      const file = line.replace(/^\+\+\+\s+(b\/)?/, "").trim();
      if (file && file !== "/dev/null" && !files.includes(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

export function applyUnifiedDiff(original: string, diff: string): string {
  const origLines = original.split("\n");
  const diffLines = diff.split("\n");
  const result: string[] = [];
  let origIdx = 0;
  let inHunk = false;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff --git") || line.startsWith("index ")) {
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      inHunk = true;
      const startLine = parseInt(hunkMatch[1], 10);
      // Copy unchanged lines up to startLine - 1 (1-indexed)
      while (origIdx < startLine - 1 && origIdx < origLines.length) {
        result.push(origLines[origIdx]);
        origIdx++;
      }
      continue;
    }

    if (inHunk) {
      if (line.startsWith("+")) {
        result.push(line.slice(1));
      } else if (line.startsWith("-")) {
        origIdx++; // skip line in original
      } else if (line.startsWith(" ")) {
        result.push(line.slice(1));
        origIdx++;
      } else if (line === "") {
        // Empty line in hunk treated as unchanged empty line
        result.push("");
        origIdx++;
      }
    }
  }

  // Copy remaining lines from original
  while (origIdx < origLines.length) {
    result.push(origLines[origIdx]);
    origIdx++;
  }

  return result.join("\n");
}

const writePatchArgs = z.object({
  patch: z.string().describe("Unified diff patch content"),
  reason: z.string().optional().describe("Reason for this change"),
});

export const writePatchTool: Tool<typeof writePatchArgs> = {
  name: "write_patch",
  description: "Apply a unified diff patch to modify workspace files.",
  args: writePatchArgs,
  risk: "workspace_write",
  async execute(args, context) {
    const targetFiles = extractTargetFilesFromPatch(args.patch);
    if (targetFiles.length === 0) {
      throw new Error("No target files found in patch. Make sure patch includes '+++ b/<filepath>' headers.");
    }

    // Check all paths are within workspace boundary
    for (const relPath of targetFiles) {
      safePath(context.workspace, relPath);
    }

    // Try applying with git apply first if in a git repository
    let gitSuccess = false;
    try {
      // Write temporary patch file
      const tempPatchPath = path.join(context.workspace, `.rig-temp-${Date.now()}.patch`);
      await writeFile(tempPatchPath, args.patch, "utf8");
      try {
        await exec("git", ["apply", "--check", tempPatchPath], { cwd: context.workspace });
        await exec("git", ["apply", tempPatchPath], { cwd: context.workspace });
        gitSuccess = true;
      } finally {
        await unlink(tempPatchPath).catch(() => {});
      }
    } catch {
      gitSuccess = false;
    }

    // If git apply failed or not in git repo, use JS unified diff parser
    if (!gitSuccess) {
      const fileHunks = args.patch.split(/^diff --git /m);
      for (const hunk of fileHunks) {
        if (!hunk.trim()) continue;
        const hunkFiles = extractTargetFilesFromPatch(hunk);
        for (const relPath of hunkFiles) {
          const absPath = safePath(context.workspace, relPath);
          let currentContent = "";
          try {
            currentContent = await readFile(absPath, "utf8");
          } catch {
            currentContent = "";
          }

          const patchedContent = applyUnifiedDiff(currentContent, hunk);
          await mkdir(path.dirname(absPath), { recursive: true });
          await writeFile(absPath, patchedContent, "utf8");
        }
      }
    }

    if (context.recordPatch) {
      await context.recordPatch(args.patch).catch(() => {});
    }

    return {
      ok: true,
      changedFiles: targetFiles,
      message: `Successfully applied patch to: ${targetFiles.join(", ")}`,
    };
  },
};
