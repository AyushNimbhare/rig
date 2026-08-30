import type { z } from "zod";
import type { RiskLevel } from "../core/agent-types.js";
import type { ToolJsonSchema } from "../model/model-client.js";

export type ToolContext = {
  workspace: string;
  sessionId?: string;
  recordPatch?: (patchContent: string) => Promise<string>;
};

export type Tool<T extends z.ZodType> = {
  name: string;
  description: string;
  args: T;
  risk: RiskLevel;
  execute: (args: z.infer<T>, context: ToolContext) => Promise<unknown>;
  toJsonSchema?: () => ToolJsonSchema;
};
