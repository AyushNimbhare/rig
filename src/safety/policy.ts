import type { RiskLevel } from "../core/agent-types.js";

export type RiskClassification = {
  risk: RiskLevel;
  requiresApproval: boolean;
  warning?: string;
};

export class SafetyPolicy {
  constructor(
    private readonly options: {
      autoApproveWrites?: boolean;
      autoApproveVerify?: boolean;
      blockedCommands?: string[];
    } = {},
  ) {}

  classify(toolName: string, args: Record<string, unknown>): RiskClassification {
    switch (toolName) {
      case "list_files":
      case "read_file":
      case "search_text":
      case "git_status":
      case "git_diff":
        return { risk: "read_only", requiresApproval: false };

      case "write_patch":
        return {
          risk: "workspace_write",
          requiresApproval: !this.options.autoApproveWrites,
          warning: "Modifies workspace files with a unified diff patch.",
        };

      case "run_shell": {
        const command = String(args["command"] || "").trim();
        return this.classifyShellCommand(command);
      }

      default:
        return {
          risk: "dangerous",
          requiresApproval: true,
          warning: `Unknown tool execution: ${toolName}`,
        };
    }
  }

  classifyShellCommand(command: string): RiskClassification {
    const trimmed = command.trim();

    // Dangerous patterns
    const dangerousPatterns = [
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-rf|--recursive)\b/,
      /\bgit\s+reset\s+--hard\b/,
      /\bgit\s+clean\s+(-[a-zA-Z]*f|-fdx?)\b/,
      /\bgit\s+checkout\s+\.\b/,
      /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)\b/,
      /\bchmod\s+777\b/,
      /\b(npm|pnpm|yarn)\s+publish\b/,
      /\bgit\s+push\s+.*--force\b/,
      /\b(mkfs|dd\s+if=)\b/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        return {
          risk: "dangerous",
          requiresApproval: true,
          warning: "High-risk command detected that may delete files or modify external state.",
        };
      }
    }

    // Safe read commands
    if (/^(ls|pwd|echo|cat|which|git\s+(status|diff|log|branch|show))(\s|$)/.test(trimmed)) {
      return { risk: "read_only", requiresApproval: false };
    }

    // Verification commands
    if (
      /^(npm\s+test|npx\s+vitest|npx\s+jest|pnpm\s+test|yarn\s+test|pytest|cargo\s+test|go\s+test|npx\s+tsc|npm\s+run\s+typecheck|npm\s+run\s+lint)(\s|$)/.test(
        trimmed,
      )
    ) {
      return {
        risk: "shell_verify",
        requiresApproval: !this.options.autoApproveVerify,
      };
    }

    // Network commands
    if (/^(curl|wget|ping|ssh|scp|git\s+(fetch|pull|clone))(\s|$)/.test(trimmed)) {
      return {
        risk: "network",
        requiresApproval: true,
        warning: "Command may access the network.",
      };
    }

    // Default shell write / build commands
    return {
      risk: "shell_write",
      requiresApproval: !this.options.autoApproveWrites,
      warning: "Runs a shell command in the workspace.",
    };
  }
}
