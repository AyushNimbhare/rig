import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Tool } from "./tool-types.js";

const exec = promisify(execFile);

export function safePath(workspace: string, relative: string): string {
  const root = path.resolve(workspace);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path '${relative}' is outside the workspace boundary`);
  }
  return target;
}

const listArgs = z.object({
  path: z.string().default(".").describe("Directory path to list relative to workspace root"),
  includeHidden: z.boolean().default(false).describe("Include dotfiles in listing"),
});

export const listFiles: Tool<typeof listArgs> = {
  name: "list_files",
  description: "List files and subdirectories in the workspace.",
  args: listArgs,
  risk: "read_only",
  async execute(args, context) {
    const directory = safePath(context.workspace, args.path);
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => args.includeHidden || !entry.name.startsWith("."))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort();
  },
};

const readArgs = z.object({
  path: z.string().describe("Path to text file relative to workspace root"),
  startLine: z.number().int().positive().default(1).describe("First line number to read (1-indexed)"),
  endLine: z.number().int().positive().default(200).describe("Last line number to read (inclusive)"),
});

export const readFileTool: Tool<typeof readArgs> = {
  name: "read_file",
  description: "Read a UTF-8 text file from the workspace within a line range.",
  args: readArgs,
  risk: "read_only",
  async execute(args, context) {
    const file = safePath(context.workspace, args.path);
    const info = await stat(file);
    if (info.size > 500_000) {
      throw new Error("File exceeds 500 KB limit. Please read in smaller chunks using startLine/endLine.");
    }
    const lines = (await readFile(file, "utf8")).split("\n");
    const requested = lines.slice(args.startLine - 1, args.endLine);
    return {
      path: args.path,
      totalLines: lines.length,
      startLine: args.startLine,
      endLine: Math.min(args.endLine, lines.length),
      content: requested.join("\n"),
    };
  },
};

const searchArgs = z.object({
  query: z.string().describe("Search string or pattern to look for"),
  path: z.string().default(".").describe("Directory or file to search within"),
  regex: z.boolean().default(false).describe("Treat query as a regular expression"),
  caseSensitive: z.boolean().default(false).describe("Perform case-sensitive search"),
  maxResults: z.number().int().positive().default(50).describe("Maximum number of search results to return"),
});

export const searchText: Tool<typeof searchArgs> = {
  name: "search_text",
  description: "Search text or regex pattern in workspace files using ripgrep.",
  args: searchArgs,
  risk: "read_only",
  async execute(args, context) {
    try {
      const rgArgs = [
        "--line-number",
        "--no-heading",
        ...(args.caseSensitive ? [] : ["--ignore-case"]),
        ...(args.regex ? [] : ["--fixed-strings"]),
        args.query,
        args.path,
      ];
      const result = await exec("rg", rgArgs, { cwd: context.workspace, maxBuffer: 1_000_000 });
      return result.stdout.split("\n").filter(Boolean).slice(0, args.maxResults);
    } catch (error: any) {
      if (error.code === 1) return []; // code 1 = no matches in ripgrep
      throw error;
    }
  },
};
