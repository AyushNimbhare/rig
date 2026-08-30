import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionEvent } from "./events.js";

export type Session = {
  id: string;
  task: string;
  workspace: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
};

export class SessionManager {
  constructor(private readonly projectRoot: string) {}

  async create(task: string, workspace = this.projectRoot): Promise<Session> {
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[:.]/g, "-")}-${slug(task)}`;
    const directory = this.directory(id);
    const session: Session = { id, task, workspace, status: "running", createdAt };
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "session.json"), JSON.stringify(session, null, 2) + "\n");
    await this.record(id, { type: "session_started", task, workspace });
    return session;
  }

  async record(id: string, event: Omit<SessionEvent, "timestamp">): Promise<void> {
    await appendFile(this.eventsPath(id), JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + "\n");
  }

  async complete(session: Session): Promise<void> {
    session.status = "completed";
    await writeFile(path.join(this.directory(session.id), "session.json"), JSON.stringify(session, null, 2) + "\n");
    await this.record(session.id, { type: "session_completed", status: session.status });
  }

  async events(id: string): Promise<SessionEvent[]> {
    const content = await readFile(this.eventsPath(id), "utf8");
    return content.trim() ? content.trim().split("\n").map((line) => JSON.parse(line) as SessionEvent) : [];
  }

  private directory(id: string): string { return path.join(this.projectRoot, ".rig", "sessions", id); }
  private eventsPath(id: string): string { return path.join(this.directory(id), "events.jsonl"); }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0,  forty());
}

function forty(): number { return 40; }
