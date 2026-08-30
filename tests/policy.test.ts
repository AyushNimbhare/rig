import { describe, expect, it } from "vitest";
import { SafetyPolicy } from "../src/safety/policy.js";

describe("Safety Policy", () => {
  const policy = new SafetyPolicy();

  it("classifies read tools as read_only without approval", () => {
    expect(policy.classify("list_files", {}).requiresApproval).toBe(false);
    expect(policy.classify("read_file", {}).requiresApproval).toBe(false);
    expect(policy.classify("git_status", {}).requiresApproval).toBe(false);
  });

  it("classifies write_patch as workspace_write requiring approval", () => {
    const classification = policy.classify("write_patch", { patch: "..." });
    expect(classification.risk).toBe("workspace_write");
    expect(classification.requiresApproval).toBe(true);
  });

  it("classifies safe shell commands as read_only", () => {
    expect(policy.classifyShellCommand("git status").risk).toBe("read_only");
    expect(policy.classifyShellCommand("ls -la").risk).toBe("read_only");
    expect(policy.classifyShellCommand("pwd").requiresApproval).toBe(false);
  });

  it("classifies test commands as shell_verify requiring approval by default", () => {
    expect(policy.classifyShellCommand("npm test").risk).toBe("shell_verify");
    expect(policy.classifyShellCommand("npx vitest run").risk).toBe("shell_verify");
  });

  it("classifies dangerous commands with high risk warnings", () => {
    const res = policy.classifyShellCommand("rm -rf node_modules");
    expect(res.risk).toBe("dangerous");
    expect(res.requiresApproval).toBe(true);

    const resetRes = policy.classifyShellCommand("git reset --hard HEAD~1");
    expect(resetRes.risk).toBe("dangerous");
  });
});
