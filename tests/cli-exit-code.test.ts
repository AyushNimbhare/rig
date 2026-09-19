import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OFFLINE_MARKER } from "../src/model/pi-model-client.js";

/**
 * End-to-end exit-code contract.
 *
 * A run that produced no real model output must not report success to a shell
 * or CI system. These tests drive the real CLI, because the exit code is the
 * whole point and it cannot be observed from a unit test.
 */

const PROVIDER_KEYS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "RIG_API_BASE_URL",
  "OPENAI_BASE_URL",
];

const TSX = path.resolve("node_modules/.bin/tsx");
const CLI = path.resolve("src/cli/index.ts");

/**
 * Spawning `tsx` compiles the whole CLI on every run, which costs a few seconds
 * on an idle machine and far more under parallel load. The timeout is generous
 * on purpose: a load-induced flake is worse than a slow test.
 */
const SPAWN_TIMEOUT = 180_000;

function offlineEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of PROVIDER_KEYS) delete env[key];
  return env;
}

function runCli(args: string[], cwd: string) {
  const result = spawnSync(TSX, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: offlineEnv(),
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function scratchWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "rig-cli-exit-"));
}

describe("CLI exit code when no model ran", () => {
  it("exits non-zero and warns on stderr for `ask`", async () => {
    const workspace = await scratchWorkspace();

    const { code, stdout, stderr } = runCli(["ask", "what is this repo"], workspace);

    expect(code).toBe(1);
    expect(stderr).toMatch(/no model output/i);
    // The answer is still delivered, and still self-identifies.
    expect(stdout).toContain(OFFLINE_MARKER);
  }, SPAWN_TIMEOUT);

  it("exits non-zero for `run`", async () => {
    const workspace = await scratchWorkspace();

    const { code, stderr } = runCli(["run", "tidy the readme", "--max-steps", "2"], workspace);

    expect(code).toBe(1);
    expect(stderr).toMatch(/no model output/i);
  }, SPAWN_TIMEOUT);

  it("keeps --json output parseable on stdout while failing on stderr", async () => {
    const workspace = await scratchWorkspace();

    const { code, stdout, stderr } = runCli(["--json", "ask", "what is this repo"], workspace);

    expect(code).toBe(1);
    expect(stderr).toMatch(/no model output/i);
    // The warning must not corrupt the machine-readable channel.
    expect(() => JSON.parse(stdout)).not.toThrow();
  }, SPAWN_TIMEOUT);
});
