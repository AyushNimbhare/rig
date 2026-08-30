import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../src/core/agent-loop.js";
import { MockModelClient } from "../src/model/mock-model.js";
import type { ModelInput, ModelOutput } from "../src/model/model-client.js";

describe("Agent Loop", () => {
  it("runs a multi-step loop and reaches completion", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-agent-test-"));

    const customModel = new MockModelClient([
      // Step 1: Request tool call
      {
        message: "Let me check the files.",
        toolCalls: [
          { id: "call_1", name: "list_files", arguments: { path: "." } },
        ],
      },
      // Step 2: Final response
      {
        message: "Found the files and finished task.",
        toolCalls: [],
      },
    ]);

    const result = await runAgentLoop(
      {
        task: "Inspect test repo",
        workspace: tmpDir,
        maxSteps: 10,
        autoApprove: true,
      },
      customModel,
    );

    expect(result.status).toBe("completed");
    expect(result.steps).toBe(2);
    expect(result.toolsUsed).toContain("list_files");
    expect(result.message).toContain("Found the files");
    expect(result.observations.length).toBe(1);
    expect(result.observations[0].ok).toBe(true);
  });

  it("handles user approval rejection cleanly", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-agent-test-"));

    const customModel = new MockModelClient([
      // Step 1: Propose a patch
      {
        message: "I will modify a file.",
        toolCalls: [
          {
            id: "call_patch",
            name: "write_patch",
            arguments: {
              patch: "--- a/test.txt\n+++ b/test.txt\n@@ -1,1 +1,1 @@\n-old\n+new",
            },
          },
        ],
      },
      // Step 2: Final response acknowledging rejection
      (input: ModelInput): ModelOutput => {
        const hasRejection = input.messages.some(
          (m) => typeof m.content === "string" && m.content.includes("rejected"),
        );
        return {
          message: hasRejection ? "Understood, skipping edit." : "Finished.",
          toolCalls: [],
        };
      },
    ]);

    const result = await runAgentLoop(
      {
        task: "Modify file",
        workspace: tmpDir,
        autoApprove: false,
        onApprovalRequest: async () => false, // Deny approval
      },
      customModel,
    );

    expect(result.status).toBe("completed");
    expect(result.message).toContain("Understood, skipping edit.");
    expect(result.observations.some((o) => o.error?.includes("rejected"))).toBe(true);
  });
});
