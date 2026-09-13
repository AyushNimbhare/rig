import { stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadModelConfig, loadProviderConfig } from "../config/provider-setup.js";
import { isWorkspaceSetup, loadWorkspaceConfig } from "../config/workspace-setup.js";
import type { SessionEvent } from "../core/events.js";
import { SessionManager, type Session } from "../core/session.js";
import { createTheme, shortPath } from "./render.js";

const exec = promisify(execFile);

const RULE = "─".repeat(40);

/** Collapse a multi-line task into a single readable line. */
function oneLine(value: string, max = 88): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max - 1) + "…" : collapsed;
}

// ── rig config ─────────────────────────────────────────────────────────────────

export type ConfigReport = {
  workspace: string;
  initialized: boolean;
  provider: { provider: string; baseUrl: string | null; apiCompat: string | null; hasApiKey: boolean } | null;
  model: string | null;
  maxSteps: number | null;
  approvals: Record<string, boolean> | null;
  instructions: { path: string; found: boolean };
  sessionCount: number;
};

export async function collectConfig(workspace: string): Promise<ConfigReport> {
  const root = path.resolve(workspace);
  const [initialized, provider, modelFromFile, workspaceConfig, sessions] = await Promise.all([
    isWorkspaceSetup(root),
    loadProviderConfig(root),
    loadModelConfig(root),
    loadWorkspaceConfig(root),
    new SessionManager(root).list(),
  ]);

  const instructionsPath = path.join(root, ".rig", "instructions.md");
  const instructionsFound = await stat(instructionsPath).then(
    (info) => info.isFile(),
    () => false,
  );

  const limits = workspaceConfig?.["limits"] as { maxSteps?: unknown } | undefined;
  const approvals = workspaceConfig?.["approvals"] as Record<string, boolean> | undefined;
  const configuredModel = workspaceConfig?.["model"];

  return {
    workspace: root,
    initialized,
    provider: provider
      ? {
          provider: provider.provider,
          baseUrl: provider.baseUrl ?? null,
          apiCompat: provider.apiCompat ?? null,
          hasApiKey: Boolean(provider.apiKey),
        }
      : null,
    model:
      modelFromFile ||
      provider?.model ||
      (typeof configuredModel === "string" ? configuredModel : undefined) ||
      process.env["RIG_MODEL"] ||
      null,
    maxSteps: typeof limits?.maxSteps === "number" ? limits.maxSteps : null,
    approvals: approvals ?? null,
    instructions: { path: instructionsPath, found: instructionsFound },
    sessionCount: sessions.length,
  };
}

export function renderConfig(report: ConfigReport, noColor = false): string {
  const theme = createTheme(noColor);
  const providerLabel = report.provider
    ? `${report.provider.provider}${report.provider.baseUrl ? ` (${report.provider.baseUrl})` : ""}${
        report.provider.apiCompat ? ` [${report.provider.apiCompat}]` : ""
      }`
    : "not configured";

  const approvalsLabel = report.approvals
    ? Object.entries(report.approvals)
        .map(([key, value]) => `${key}=${value ? "on" : "off"}`)
        .join("  ")
    : "default (prompt per action)";

  const rows: Array<[string, string, boolean]> = [
    ["workspace", shortPath(report.workspace), false],
    ["initialized", report.initialized ? "yes" : "no", !report.initialized],
    ["provider", providerLabel, !report.provider],
    ["api key", report.provider?.hasApiKey ? "set" : "not set", false],
    ["model", report.model ?? "not configured", !report.model],
    ["max steps", report.maxSteps === null ? "default (30)" : String(report.maxSteps), false],
    ["approvals", approvalsLabel, false],
    ["instructions", `${shortPath(report.instructions.path)} ${report.instructions.found ? "(found)" : "(not created)"}`, false],
    ["sessions", `${report.sessionCount} saved`, false],
  ];

  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = ["", `  ${theme.brand("RIG CONFIG")}`, `  ${theme.dim(RULE)}`];
  for (const [label, value, warn] of rows) {
    lines.push(`    ${theme.accent(label.padEnd(width))}  ${warn ? theme.warn(value) : theme.text(value)}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── rig log ────────────────────────────────────────────────────────────────────

export type SessionSummary = {
  id: string;
  task: string;
  status: Session["status"];
  createdAt: string;
  steps: number;
  patchCount: number;
};

export async function collectSessions(workspace: string): Promise<SessionSummary[]> {
  const manager = new SessionManager(path.resolve(workspace));
  const sessions = await manager.list();

  return Promise.all(
    sessions.map(async (session) => {
      const [events, patches] = await Promise.all([
        manager.events(session.id).catch(() => [] as SessionEvent[]),
        manager.patches(session.id),
      ]);
      return {
        id: session.id,
        task: session.task,
        status: session.status,
        createdAt: session.createdAt,
        steps: events.filter((event) => event.type === "model_response").length,
        patchCount: patches.length,
      };
    }),
  );
}

export function renderSessionList(sessions: SessionSummary[], noColor = false): string {
  const theme = createTheme(noColor);
  if (sessions.length === 0) {
    return `\n  ${theme.warn("No RIG sessions found in this workspace.")}\n`;
  }

  const lines = ["", `  ${theme.brand(`RIG SESSIONS (${sessions.length})`)}`, `  ${theme.dim(RULE)}`];
  for (const session of sessions) {
    const statusColor = session.status === "completed" ? theme.success : session.status === "failed" ? theme.error : theme.warn;
    lines.push(`    ${theme.accent(session.id)}`);
    lines.push(
      `      ${theme.muted("status")}  ${statusColor(session.status.padEnd(10))}` +
        `${theme.muted("steps")} ${theme.text(String(session.steps).padEnd(5))}` +
        `${theme.muted("patches")} ${theme.text(String(session.patchCount))}`,
    );
    lines.push(`      ${theme.muted("task")}    ${theme.text(oneLine(session.task))}`);
    lines.push("");
  }
  return lines.join("\n");
}

export type SessionDetail = {
  session: Session;
  events: SessionEvent[];
  patches: string[];
};

export async function collectSessionDetail(workspace: string, id: string): Promise<SessionDetail | undefined> {
  const manager = new SessionManager(path.resolve(workspace));
  const session = await manager.load(id);
  if (!session) return undefined;

  const [events, patches] = await Promise.all([
    manager.events(id).catch(() => [] as SessionEvent[]),
    manager.patches(id),
  ]);
  return { session, events, patches };
}

/** Newest session that did not finish cleanly, used as the default resume target. */
export async function findResumableSession(workspace: string, id?: string): Promise<Session | undefined> {
  const manager = new SessionManager(path.resolve(workspace));
  if (id) return manager.load(id);
  const sessions = await manager.list();
  return sessions.find((session) => session.status !== "completed") ?? sessions[0];
}

function describeEvent(event: SessionEvent): string {
  switch (event.type) {
    case "session_started":
      return `task: ${String(event["task"] ?? "")}`;
    case "session_resumed":
      return "session resumed";
    case "model_response":
      return `${String(event["toolCallsCount"] ?? 0)} tool call(s) at step ${String(event["step"] ?? "?")}`;
    case "tool_observation":
      return `${String(event["tool"])} ${event["ok"] === false ? "failed" : "ok"}${
        event["error"] ? ` — ${String(event["error"])}` : ""
      }`;
    case "approval_resolved":
      return `${String(event["tool"])} ${event["approved"] ? "approved" : "denied"}`;
    case "patch_applied":
      return `recorded ${String(event["path"] ?? "")}`;
    default:
      return "";
  }
}

export function renderSessionDetail(detail: SessionDetail, noColor = false): string {
  const theme = createTheme(noColor);
  const { session, events, patches } = detail;
  const statusColor = session.status === "completed" ? theme.success : session.status === "failed" ? theme.error : theme.warn;

  const lines = [
    "",
    `  ${theme.brand("RIG SESSION")} ${theme.accent(session.id)}`,
    `  ${theme.dim(RULE)}`,
    `    ${theme.accent("task")}     ${theme.text(oneLine(session.task, 160))}`,
    `    ${theme.accent("status")}   ${statusColor(session.status)}`,
    `    ${theme.accent("created")}  ${theme.text(session.createdAt)}`,
    `    ${theme.accent("workspace")} ${theme.text(shortPath(session.workspace))}`,
    `    ${theme.accent("patches")}  ${theme.text(patches.length > 0 ? patches.join(", ") : "none")}`,
    "",
    `  ${theme.brand("EVENTS")} ${theme.muted(`(${events.length})`)}`,
    `  ${theme.dim(RULE)}`,
  ];

  if (events.length === 0) {
    lines.push(`    ${theme.muted("no events recorded")}`);
  } else {
    for (const [index, event] of events.entries()) {
      const detailText = describeEvent(event);
      lines.push(
        `    ${theme.dim(String(index + 1).padStart(3))}  ${theme.accent(event.type.padEnd(18))} ${
          detailText ? theme.muted(detailText) : ""
        }`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

// ── rig review ─────────────────────────────────────────────────────────────────

export type ReviewDiff = {
  staged: boolean;
  file: string | null;
  diff: string;
  files: string[];
};

export async function collectReviewDiff(
  workspace: string,
  options: { staged?: boolean; file?: string } = {},
): Promise<ReviewDiff> {
  const root = path.resolve(workspace);
  const gitArgs = ["diff"];
  if (options.staged) gitArgs.push("--cached");
  if (options.file) gitArgs.push("--", options.file);

  let diff = "";
  try {
    const result = await exec("git", gitArgs, { cwd: root, maxBuffer: 4_000_000 });
    diff = result.stdout.trim();
  } catch (error) {
    const failure = error as { stderr?: string; message?: string };
    const stderr = (failure.stderr ?? "").trim();
    const detail = stderr || failure.message || String(error);

    if (/not a git repository/i.test(detail)) {
      throw new Error("This workspace is not a git repository, so there is no diff to review.");
    }

    // execFile embeds the whole stderr block in the message; keep it to one line.
    throw new Error(`Unable to read git diff: ${detail.split("\n")[0]}`);
  }

  const files = [...new Set(
    diff
      .split("\n")
      .filter((line) => line.startsWith("+++ b/"))
      .map((line) => line.slice("+++ b/".length).trim())
      .filter((file) => file && file !== "/dev/null"),
  )];

  return { staged: Boolean(options.staged), file: options.file ?? null, diff, files };
}

export function buildReviewTask(review: ReviewDiff): string {
  const scope = review.file ? `the file ${review.file}` : "the current workspace changes";
  return [
    `Review ${scope} and report findings.`,
    "",
    "Rank every finding by severity (P1 critical, P2 important, P3 minor) and for each one give:",
    "- the file and line involved",
    "- why it is a problem (bug, security risk, or missing test coverage)",
    "- a concrete suggested fix",
    "",
    "Inspect the surrounding code with the read tools before reporting. If you find nothing",
    "worth flagging, say so explicitly instead of inventing issues.",
    "",
    "The diff to review:",
    "```diff",
    review.diff,
    "```",
  ].join("\n");
}

export function renderReviewHeader(review: ReviewDiff, noColor = false): string {
  const theme = createTheme(noColor);
  return [
    "",
    `  ${theme.brand("RIG REVIEW")}`,
    `  ${theme.dim(RULE)}`,
    `    ${theme.accent("source")}  ${theme.text(review.staged ? "staged changes (git diff --cached)" : "unstaged changes (git diff)")}`,
    `    ${theme.accent("files")}   ${theme.text(review.files.length > 0 ? review.files.join(", ") : "none")}`,
    "",
  ].join("\n");
}
