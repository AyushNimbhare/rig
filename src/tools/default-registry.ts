import { gitDiff, gitStatus } from "./git.js";
import { listFiles, readFileTool, searchText } from "./read-only.js";
import { ToolRegistry } from "./registry.js";
import { runShellTool } from "./run-shell.js";
import { writePatchTool } from "./write-patch.js";

/**
 * The set of tools RIG exposes to a model.
 *
 * Defined once so the CLI, the agent loop and the public SDK cannot drift
 * apart — previously this was duplicated, and only the private copy was
 * actually executed.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(listFiles);
  registry.register(readFileTool);
  registry.register(searchText);
  registry.register(gitStatus);
  registry.register(gitDiff);
  registry.register(writePatchTool);
  registry.register(runShellTool);
  return registry;
}
