import type { ToolCall } from "../model/model-client.js";
import type { ModelSource } from "./model-factory.js";

export type RiskLevel =
  | "read_only"
  | "workspace_write"
  | "shell_verify"
  | "shell_write"
  | "dangerous"
  | "network";

export type AgentInput = {
  task: string;
  workspace?: string;
  maxSteps?: number;
  autoApprove?: boolean;
  model?: string;
  /** Continue an existing session instead of starting a new one. */
  resumeSessionId?: string;
  onTurn?: (event: AgentStepEvent) => void;
  onApprovalRequest?: (request: ApprovalRequest) => Promise<boolean>;
};

export type ApprovalRequest = {
  tool: string;
  arguments: Record<string, unknown>;
  risk: RiskLevel;
  reason?: string;
};

export type ToolObservation = {
  tool: string;
  ok: boolean;
  result: unknown;
  error?: string;
};

export type AgentStepEvent =
  | { type: "model_thinking"; message?: string }
  | { type: "model_message"; message: string }
  | { type: "tool_called"; tool: string; args: Record<string, unknown>; risk: RiskLevel }
  | { type: "approval_requested"; request: ApprovalRequest }
  | { type: "approval_resolved"; approved: boolean }
  | { type: "tool_observation"; observation: ToolObservation }
  | { type: "step_completed"; stepIndex: number };

export type AgentResult = {
  status: "completed" | "stopped" | "failed" | "max_steps_exceeded";
  message: string;
  sessionId: string;
  steps: number;
  toolsUsed: string[];
  filesChanged: string[];
  observations: ToolObservation[];
  /**
   * Where the model output came from. Only `provider` means a real model
   * reasoned about the task; `offline` and `mock` mean the message is
   * scripted and must not be treated as a genuine answer.
   */
  modelSource?: ModelSource;
};
