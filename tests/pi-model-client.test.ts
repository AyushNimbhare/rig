import { describe, expect, it } from "vitest";
import { OFFLINE_MARKER, PiModelClient } from "../src/model/pi-model-client.js";
import type { ChatMessage } from "../src/model/model-client.js";

/**
 * The offline client exists so the harness can run without credentials. Its one
 * non-negotiable property is that it must never be mistaken for a real model:
 * a misconfigured provider has to look broken, not working.
 */

const USER_TURN: ChatMessage[] = [{ role: "user", content: "Fix the failing test" }];

/** A history that already contains an assistant tool call, i.e. step 2+. */
const AFTER_TOOLS: ChatMessage[] = [
  ...USER_TURN,
  {
    role: "assistant",
    content: "inspecting",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "list_files", arguments: "{}" },
      },
    ],
  },
  { role: "tool", tool_call_id: "call_1", content: "[]" },
];

describe("PiModelClient (offline fallback)", () => {
  it("labels its first turn as offline and emits real tool calls", async () => {
    const client = new PiModelClient("gpt-4o-mini");
    const output = await client.generate({ messages: USER_TURN });

    expect(output.message).toContain(OFFLINE_MARKER);
    expect(output.finishReason).toBe("tool_calls");
    expect(output.toolCalls.map((c) => c.name)).toEqual(["list_files", "git_status"]);
  });

  it("labels its final turn as offline", async () => {
    const client = new PiModelClient("gpt-4o-mini");
    const output = await client.generate({ messages: AFTER_TOOLS });

    expect(output.message).toContain(OFFLINE_MARKER);
    expect(output.finishReason).toBe("stop");
    expect(output.toolCalls).toEqual([]);
  });

  it("states plainly that no model was called and says what it would have used", async () => {
    const client = new PiModelClient("gpt-4o-mini");
    const output = await client.generate({ messages: AFTER_TOOLS });

    expect(output.message).toMatch(/no model was called/i);
    expect(output.message).toContain("gpt-4o-mini");
    expect(output.message).toMatch(/configure a provider/i);
  });

  it("never claims a real model produced the output", async () => {
    const client = new PiModelClient("gpt-4o-mini");

    for (const messages of [USER_TURN, AFTER_TOOLS]) {
      const { message } = await client.generate({ messages });
      // The dishonest strings the previous implementation emitted.
      expect(message).not.toMatch(/Analysis complete for/i);
      expect(message).not.toMatch(/Model used:/i);
      // The invariant: every message is marked.
      expect(message).toContain(OFFLINE_MARKER);
    }
  });

  it("surfaces the model name and thinking level it would have called", async () => {
    const client = new PiModelClient("qwen2.5-coder", {
      model: "qwen2.5-coder",
      thinkingLevel: "high",
    });
    const output = await client.generate({ messages: AFTER_TOOLS });

    expect(output.message).toContain("qwen2.5-coder");
    expect(output.message).toContain("high");
  });
});
