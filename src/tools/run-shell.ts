import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Tool } from "./tool-types.js";

const execPromise = promisify(exec);

const MAX_OUTPUT_CHARS = 30_000;

function truncateOutput(output: string, max = MAX_OUTPUT_CHARS): string {
  if (output.length <= max) return output;
  const half = Math.floor(max / 2);
  const head = output.slice(0, half);
  const tail = output.slice(output.length - half);
  return `${head}\n\n... [${output.length - max} characters truncated] ...\n\n${tail}`;
}

const runShellArgs = z.object({
  command: z.string().describe("The shell command to execute"),
  timeoutMs: z.number().int().positive().default(60000).describe("Timeout in milliseconds (default: 60000)"),
  reason: z.string().optional().describe("Reason for executing this command"),
});

export const runShellTool: Tool<typeof runShellArgs> = {
  name: "run_shell",
  description: "Execute a shell command within the workspace directory.",
  args: runShellArgs,
  risk: "shell_write",
  async execute(args, context) {
    try {
      const { stdout, stderr } = await execPromise(args.command, {
        cwd: context.workspace,
        timeout: args.timeoutMs,
        maxBuffer: 5_000_000,
        env: {
          ...process.env,
          CI: "true",
          FORCE_COLOR: "0",
        },
      });

      return {
        ok: true,
        exitCode: 0,
        stdout: truncateOutput(stdout.trim()),
        stderr: truncateOutput(stderr.trim()),
      };
    } catch (err: any) {
      return {
        ok: false,
        exitCode: err.code || 1,
        stdout: truncateOutput(err.stdout ? String(err.stdout).trim() : ""),
        stderr: truncateOutput(err.stderr ? String(err.stderr).trim() : (err.message || String(err))),
      };
    }
  },
};
