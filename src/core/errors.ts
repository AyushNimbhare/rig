export class RigError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "RigError";
  }
}

export class ToolExecutionError extends RigError {
  constructor(toolName: string, message: string) {
    super(`Tool '${toolName}' failed: ${message}`, "TOOL_EXECUTION_ERROR");
  }
}

export class SafetyViolationError extends RigError {
  constructor(message: string) {
    super(`Safety policy violation: ${message}`, "SAFETY_VIOLATION");
  }
}

export class ModelClientError extends RigError {
  constructor(message: string, public readonly status?: number) {
    super(message, "MODEL_CLIENT_ERROR");
  }
}
