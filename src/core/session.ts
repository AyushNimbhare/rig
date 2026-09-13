import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionEvent } from "./events.js";

export type Session = {
  id: string;
  task: string;
  workspace: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
};

const SLUG_MAX_LENGTH = 40;

export class SessionManager {
  constructor(private readonly projectRoot: string) {}

  async create(task: string, workspace = this.projectRoot): Promise<Session> {
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[:.]/g, "-")}-${slug(task)}`;
    const directory = this.directory(id);
    const session: Session = { id, task, workspace, status: "running", createdAt };
    await mkdir(directory, { recursive: true });
    await this.write(session);
    await this.record(id, { type: "session_started", task, workspace });
    return session;
  }

  async record(id: string, event: Omit<SessionEvent, "timestamp">): Promise<void> {
    await appendFile(this.eventsPath(id), JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + "\n");
  }

  async complete(session: Session, finalStatus?: "completed" | "failed"): Promise<void> {
    const status = finalStatus ?? "completed";
    session.status = status;
    await this.write(session);
    await this.record(session.id, { type: "session_" + status, status: session.status });
  }

  async events(id: string): Promise<SessionEvent[]> {
    const content = await readFile(this.eventsPath(id), "utf8");
    return content.trim() ? content.trim().split("\n").map((line) => JSON.parse(line) as SessionEvent) : [];
  }

  /** Read a single session's metadata, or `undefined` when it is missing/corrupt. */
  async load(id: string): Promise<Session | undefined> {
    try {
      const parsed = JSON.parse(await readFile(path.join(this.directory(id), "session.json"), "utf8")) as Session;
      return parsed && typeof parsed.id === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** All recorded sessions, newest first. */
  async list(): Promise<Session[]> {
    let entries: string[];
    try {
      entries = await readdir(this.sessionsRoot(), { withFileTypes: true }).then((found) =>
        found.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
      );
    } catch {
      return [];
    }

    const sessions = await Promise.all(entries.map((entry) => this.load(entry)));
    return sessions
      .filter((session): session is Session => Boolean(session))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Mark an existing session as running again and log the resume event. */
  async resume(id: string): Promise<Session | undefined> {
    const session = await this.load(id);
    if (!session) return undefined;
    session.status = "running";
    await this.write(session);
    await this.record(id, { type: "session_resumed", task: session.task });
    return session;
  }

  /** Patch artifacts captured for a session, in application order. */
  async patches(id: string): Promise<string[]> {
    try {
      const found = await readdir(path.join(this.directory(id), "patches"));
      return found.filter((name) => name.endsWith(".patch")).sort();
    } catch {
      return [];
    }
  }

  private async write(session: Session): Promise<void> {
    await writeFile(path.join(this.directory(session.id), "session.json"), JSON.stringify(session, null, 2) + "\n");
  }

  private sessionsRoot(): string {
    return path.join(this.projectRoot, ".rig", "sessions");
  }

  private directory(id: string): string {
    return path.join(this.sessionsRoot(), id);
  }

  private eventsPath(id: string): string {
    return path.join(this.directory(id), "events.jsonl");
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, SLUG_MAX_LENGTH);
}
