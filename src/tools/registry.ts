import { z } from "zod";
import type { ToolJsonSchema } from "../model/model-client.js";
import type { Tool } from "./tool-types.js";

/**
 * Normalise a Zod schema's internal discriminator across Zod 3 and Zod 4.
 *
 * - Zod 3 exposes `_def.typeName` ("ZodString", "ZodDefault", ...)
 * - Zod 4 removed `typeName` in favour of `_def.type` ("string", "default", ...)
 *
 * Returns a lowercase kind such as "string", "default" or "optional".
 */
function schemaKind(schema: unknown): string {
  const candidate = schema as { _def?: Record<string, unknown>; constructor?: { name?: string } };
  const def = candidate?._def ?? {};
  const raw = def["type"] ?? def["typeName"] ?? candidate?.constructor?.name ?? "";
  const name = String(raw);
  return (name.startsWith("Zod") ? name.slice(3) : name).toLowerCase();
}

/** Kinds that wrap another schema and are transparent for JSON-schema purposes. */
const WRAPPER_KINDS = new Set(["default", "optional", "prefault", "nullable", "readonly", "catch"]);

/**
 * Hand-rolled Zod -> JSON Schema converter.
 *
 * Used as a fallback when the installed Zod version has no native `toJSONSchema`
 * (i.e. Zod 3). Optional and defaulted fields are deliberately omitted from
 * `required` so the model is free to leave them out and let Zod apply defaults.
 */
export function legacyZodTypeToJsonSchema(schema: unknown): Record<string, unknown> {
  const node = schema as {
    _def?: Record<string, unknown>;
    description?: string;
    constructor?: { name?: string };
  };
  const def = node?._def ?? {};
  const kind = schemaKind(schema);

  if (WRAPPER_KINDS.has(kind)) {
    return legacyZodTypeToJsonSchema(def["innerType"]);
  }

  const description = node.description;

  switch (kind) {
    case "string":
      return { type: "string", ...(description ? { description } : {}) };
    case "number":
      return { type: "number", ...(description ? { description } : {}) };
    case "boolean":
      return { type: "boolean", ...(description ? { description } : {}) };
    case "array":
      return {
        type: "array",
        items: legacyZodTypeToJsonSchema(def["type"] ?? def["element"]),
        ...(description ? { description } : {}),
      };
    case "enum": {
      const entries = def["entries"] ?? def["values"];
      const values = Array.isArray(entries)
        ? entries
        : entries && typeof entries === "object"
          ? Object.values(entries)
          : [];
      return { type: "string", enum: values, ...(description ? { description } : {}) };
    }
    case "literal": {
      const values = def["values"] ?? def["value"];
      const literal = Array.isArray(values) ? values[0] : values;
      return { type: typeof literal === "number" ? "number" : typeof literal === "boolean" ? "boolean" : "string" };
    }
    case "object": {
      const rawShape = def["shape"];
      const shape: Record<string, unknown> =
        typeof rawShape === "function" ? (rawShape as () => Record<string, unknown>)() : (rawShape as Record<string, unknown>) ?? {};

      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = legacyZodTypeToJsonSchema(value);
        const fieldKind = schemaKind(value);
        // Only genuinely mandatory fields belong in `required`.
        if (fieldKind !== "optional" && fieldKind !== "default" && fieldKind !== "prefault") {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      };
    }
    default:
      return { type: "string", ...(description ? { description } : {}) };
  }
}

/**
 * Convert a Zod schema into an OpenAI-compatible JSON Schema fragment.
 *
 * Prefers Zod 4's native converter in `input` mode, which correctly excludes
 * defaulted/optional fields from `required`. Falls back to the hand-rolled
 * converter on Zod 3.
 */
export function zodTypeToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const native = (z as unknown as {
    toJSONSchema?: (target: unknown, options?: Record<string, unknown>) => Record<string, unknown>;
  }).toJSONSchema;

  if (typeof native === "function") {
    try {
      const generated = { ...native(schema, { io: "input", target: "draft-7" }) };
      delete generated["$schema"];
      return generated;
    } catch {
      // Unsupported constructs (transforms, dates, ...) fall through below.
    }
  }

  return legacyZodTypeToJsonSchema(schema);
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<z.ZodType>>();

  register<T extends z.ZodType>(tool: Tool<T>): void {
    this.tools.set(tool.name, tool as Tool<z.ZodType>);
  }

  get(name: string): Tool<z.ZodType> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  definitions(): Array<Pick<Tool<z.ZodType>, "name" | "description" | "risk">> {
    return [...this.tools.values()].map(({ name, description, risk }) => ({ name, description, risk }));
  }

  toJsonSchemas(): ToolJsonSchema[] {
    return [...this.tools.values()].map((tool) => {
      if (tool.toJsonSchema) return tool.toJsonSchema();
      const parameters = zodTypeToJsonSchema(tool.args);
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters,
        },
      };
    });
  }
}
