import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session.js";

describe("SessionManager", () => {
  it("creates a session and appends JSONL events", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rig-"));
    const manager = new SessionManager(root);
    const session = await manager.create("inspect project");
    await manager.record(session.id, { type: "test_event" });
    const events = await manager.events(session.id);
    expect(events.map((event) => event.type)).toEqual(["session_started", "test_event"]);
    expect(await readFile(path.join(root, ".rig/sessions", session.id, "session.json"), "utf8")).toContain(session.id);
  });
});
