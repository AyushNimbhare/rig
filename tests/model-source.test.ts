import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgentLoop } from "../src/core/agent-loop.js";
import { createModelClient, isUnrealSource, modelSourceOf } from "../src/core/model-factory.js";
import { MockModelClient } from "../src/model/mock-model.js";
import { OFFLINE_MARKER } from "../src/model/pi-model-client.js";

/**
 * `modelSource` is what lets the CLI fail closed: only a real provider means the
 * run produced a genuine answer. These tests pin that classification, since the
 * exit-code contract depends on it.
 */

const PROVIDER_KEYS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "RIG_API_BASE_URL",
  "OPENAI_BASE_URL",
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of PROVIDER_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of PROVIDER_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function scratchWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "rig-model-source-"));
}

describe("model source classification", () => {
  it("reports offline when no provider is configured", () => {
    const client = createModelClient("gpt-4o-mini");

    expect(modelSourceOf(client)).toBe("offline");
    expect(isUnrealSource("offline")).toBe(true);
  });

  it("reports provider when a key is present", () => {
    process.env["OPENAI_API_KEY"] = "sk-test-not-a-real-key";
    const client = createModelClient("gpt-4o-mini");

    expect(modelSourceOf(client)).toBe("provider");
    expect(isUnrealSource("provider")).toBe(false);
  });

  it("reports mock for an injected mock client", () => {
    expect(modelSourceOf(new MockModelClient())).toBe("mock");
    expect(isUnrealSource("mock")).toBe(true);
  });

  it("treats an unknown source as not unreal", () => {
    expect(isUnrealSource(undefined)).toBe(false);
  });
});

describe("agent results carry their model source", () => {
  it("reports offline, and says so, with no provider configured", async () => {
    const workspace = await scratchWorkspace();

    const result = await runAgentLoop({ task: "say hi", workspace, maxSteps: 3 });

    expect(result.status).toBe("completed");
    expect(result.modelSource).toBe("offline");
    // The source must agree with what the user is actually shown.
    expect(result.message).toContain(OFFLINE_MARKER);
  });

  it("reports mock when the caller injects a mock client", async () => {
    const workspace = await scratchWorkspace();

    const result = await runAgentLoop(
      { task: "say hi", workspace, maxSteps: 3 },
      new MockModelClient(),
    );

    expect(result.modelSource).toBe("mock");
  });
});
