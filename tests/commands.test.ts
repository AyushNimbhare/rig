import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReviewTask,
  collectConfig,
  collectReviewDiff,
  collectSessionDetail,
  collectSessions,
  findResumableSession,
  renderConfig,
  renderSessionDetail,
  renderSessionList,
} from "../src/cli/commands.js";
import { saveModelConfig, saveProviderConfig } from "../src/config/provider-setup.js";
import { setupWorkspace } from "../src/config/workspace-setup.js";
import { SessionManager } from "../src/core/session.js";
import { VERSION } from "../src/version.js";

async function tempWorkspace(prefix = "rig-cmd-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("rig config", () => {
  it("reports an uninitialised workspace without throwing", async () => {
    const workspace = await tempWorkspace();
    const report = await collectConfig(workspace);

    expect(report.workspace).toBe(path.resolve(workspace));
    expect(report.initialized).toBe(false);
    expect(report.provider).toBeNull();
    expect(report.sessionCount).toBe(0);
    expect(renderConfig(report, true)).toContain("RIG CONFIG");
  });

  it("reflects the saved provider, model and limits", async () => {
    const workspace = await tempWorkspace();
    await setupWorkspace(workspace);
    await saveProviderConfig(workspace, {
      provider: "ollama",
      apiKey: "",
      baseUrl: "http://localhost:11434/v1",
      apiCompat: "openai",
      updatedAt: new Date().toISOString(),
    });
    await saveModelConfig(workspace, "llama3.1");

    const report = await collectConfig(workspace);

    expect(report.initialized).toBe(true);
    expect(report.provider).toMatchObject({ provider: "ollama", baseUrl: "http://localhost:11434/v1" });
    expect(report.model).toBe("llama3.1");
    expect(report.maxSteps).toBe(30);
    expect(report.instructions.found).toBe(true);
  });
});

describe("rig log", () => {
  it("summarises recorded sessions and their events", async () => {
    const workspace = await tempWorkspace();
    const manager = new SessionManager(workspace);
    const session = await manager.create("inspect the repo");
    await manager.record(session.id, { type: "model_response", step: 1, toolCallsCount: 2 });
    await manager.complete(session);

    const summaries = await collectSessions(workspace);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: session.id, task: "inspect the repo", status: "completed", steps: 1 });
    expect(renderSessionList(summaries, true)).toContain("inspect the repo");

    const detail = await collectSessionDetail(workspace, session.id);
    expect(detail?.events.map((event) => event.type)).toEqual([
      "session_started",
      "model_response",
      "session_completed",
    ]);
    expect(renderSessionDetail(detail!, true)).toContain("session_completed");
  });

  it("returns undefined for an unknown session", async () => {
    const workspace = await tempWorkspace();
    expect(await collectSessionDetail(workspace, "does-not-exist")).toBeUndefined();
    expect(await collectSessions(workspace)).toEqual([]);
  });
});

describe("rig resume", () => {
  it("prefers the newest unfinished session", async () => {
    const workspace = await tempWorkspace();
    const manager = new SessionManager(workspace);

    const finished = await manager.create("already done");
    await manager.complete(finished);
    const pending = await manager.create("still running");

    const target = await findResumableSession(workspace);
    expect(target?.id).toBe(pending.id);
  });

  it("marks the session running again and records the resume", async () => {
    const workspace = await tempWorkspace();
    const manager = new SessionManager(workspace);
    const session = await manager.create("half finished task");
    await manager.complete(session, "failed");

    const resumed = await manager.resume(session.id);

    expect(resumed?.status).toBe("running");
    const events = await manager.events(session.id);
    expect(events.map((event) => event.type)).toContain("session_resumed");
  });
});

describe("rig review", () => {
  it("collects the staged diff and builds a review task", async () => {
    const workspace = await tempWorkspace();
    execFileSync("git", ["init", "-q"], { cwd: workspace });
    await writeFile(path.join(workspace, "app.ts"), "export const value = 1;\n");
    execFileSync("git", ["add", "app.ts"], { cwd: workspace });
    await writeFile(path.join(workspace, "app.ts"), "export const value = 2;\n");
    execFileSync("git", ["add", "app.ts"], { cwd: workspace });

    const review = await collectReviewDiff(workspace, { staged: true });

    expect(review.files).toEqual(["app.ts"]);
    expect(review.diff).toContain("app.ts");
    expect(buildReviewTask(review)).toContain("P1 critical");
    expect(buildReviewTask(review)).toContain(review.diff);
  });

  it("reports an empty diff when the workspace is clean", async () => {
    const workspace = await tempWorkspace();
    execFileSync("git", ["init", "-q"], { cwd: workspace });
    const review = await collectReviewDiff(workspace);
    expect(review.diff).toBe("");
    expect(review.files).toEqual([]);
  });
});

describe("version", () => {
  it("matches package.json so --version cannot drift", async () => {
    const pkg = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
