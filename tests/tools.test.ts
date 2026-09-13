import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createDefaultToolRegistry } from "../src/core/agent-loop.js";
import { ToolRegistry, legacyZodTypeToJsonSchema } from "../src/tools/registry.js";
import { gitStatus } from "../src/tools/git.js";
import { listFiles } from "../src/tools/read-only.js";

type Parameters = { required?: string[]; properties?: Record<string, unknown> };

function parametersFor(name: string): Parameters {
  const schema = createDefaultToolRegistry()
    .toJsonSchemas()
    .find((entry) => entry.function.name === name);
  if (!schema) throw new Error(`No schema generated for tool '${name}'`);
  return schema.function.parameters as Parameters;
}

describe("ToolRegistry", () => {
  it("registers and exposes typed tools", () => {
    const registry = new ToolRegistry();
    registry.register(listFiles); registry.register(gitStatus);
    expect(registry.get("list_files").name).toBe("list_files");
    expect(registry.definitions()).toHaveLength(2);
  });
});

describe("ToolRegistry JSON schemas", () => {
  it("only marks genuinely mandatory parameters as required", () => {
    // Every other parameter on these tools carries a .default() or .optional().
    expect(parametersFor("list_files").required ?? []).toEqual([]);
    expect(parametersFor("git_status").required ?? []).toEqual([]);
    expect(parametersFor("git_diff").required ?? []).toEqual([]);
    expect(parametersFor("read_file").required).toEqual(["path"]);
    expect(parametersFor("search_text").required).toEqual(["query"]);
    expect(parametersFor("write_patch").required).toEqual(["patch"]);
    expect(parametersFor("run_shell").required).toEqual(["command"]);
  });

  it("keeps optional parameters in properties with their real types", () => {
    const listFilesSchema = parametersFor("list_files");
    expect(listFilesSchema.properties).toMatchObject({
      path: { type: "string" },
      includeHidden: { type: "boolean" },
    });

    const runShellSchema = parametersFor("run_shell");
    expect(runShellSchema.properties).toMatchObject({
      command: { type: "string" },
      timeoutMs: { type: "integer" },
      reason: { type: "string" },
    });
  });

  it("does not leak the JSON Schema meta key into OpenAI tool parameters", () => {
    expect(parametersFor("run_shell")).not.toHaveProperty("$schema");
  });
});

describe("legacy Zod converter (Zod 3 fallback)", () => {
  it("omits defaulted and optional fields from required", () => {
    const schema = z.object({
      command: z.string().describe("required"),
      timeoutMs: z.number().int().positive().default(60000),
      reason: z.string().optional(),
    });

    expect(legacyZodTypeToJsonSchema(schema)).toMatchObject({
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string", description: "required" },
        timeoutMs: { type: "number" },
        reason: { type: "string" },
      },
    });
  });

  it("omits the required key entirely when every field is optional", () => {
    const schema = z.object({ staged: z.boolean().default(false), file: z.string().optional() });
    const generated = legacyZodTypeToJsonSchema(schema);
    expect(generated).not.toHaveProperty("required");
    expect(generated["additionalProperties"]).toBe(false);
  });
});
