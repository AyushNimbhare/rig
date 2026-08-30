import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Tool } from "./tool-types.js";

const exec = promisify(execFile);

const gitStatusArgs = z.object({});
export const gitStatus: Tool<typeof gitStatusArgs> = {
  name: "git_status",
  description: "Return concise git status including current branch and modified files.",
  args: gitStatusArgs,
  risk: "read_only",
  async execute(_, context) {
    try {
      const res = await exec("git", ["status", "--short", "--branch"], { cwd: context.workspace });
      return res.stdout.trim() || "Working tree clean";
    } catch {
      return "Not a git repository";
    }
  },
};

const gitDiffArgs = z.object({
  staged: z.boolean().default(false).describe("Compare staged changes (git diff --cached)"),
  file: z.string().optional().describe("Optional specific file path to diff"),
});

export const gitDiff: Tool<typeof gitDiffArgs> = {
  name: "git_diff",
  description: "Return current git diff for unstaged or staged changes in workspace.",
  args: gitDiffArgs,
  risk: "read_only",
  async execute(args, context) {
    try {
      const gitArgs = ["diff"];
      if (args.staged) gitArgs.push("--cached");
      if (args.file) gitArgs.push("--", args.file);

      const res = await exec("git", gitArgs, { cwd: context.workspace, maxBuffer: 2_000_000 });
      return res.stdout.trim() || "No git diff";
    } catch (err: any) {
      return `Git diff failed: ${err.message || String(err)}`;
    }
  },
};
