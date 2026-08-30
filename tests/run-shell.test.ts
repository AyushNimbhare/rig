import { describe, expect, it } from "vitest";
import { runShellTool } from "../src/tools/run-shell.js";

describe("run_shell Tool", () => {
  it("executes simple echo command successfully", async () => {
    const result = (await runShellTool.execute(
      { command: "echo 'hello rig'", timeoutMs: 5000 },
      { workspace: process.cwd() },
    )) as any;

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello rig");
  });

  it("handles non-zero exit codes gracefully without crashing", async () => {
    const result = (await runShellTool.execute(
      { command: "exit 42", timeoutMs: 5000 },
      { workspace: process.cwd() },
    )) as any;

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(42);
  });
});
