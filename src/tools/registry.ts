import type { z } from "zod";
import type { ToolJsonSchema } from "../model/model-client.js";
import type { Tool } from "./tool-types.js";

function zodTypeToJsonSchema(schema: any): Record<string, unknown> {
  const typeName = schema._def?.typeName || schema.constructor?.name;

  if (typeName === "ZodDefault" || typeName === "ZodOptional") {
    return zodTypeToJsonSchema(schema._def.innerType);
  }

  if (typeName === "ZodString") {
    return { type: "string", description: schema.description };
  }

  if (typeName === "ZodNumber") {
    return { type: "number", description: schema.description };
  }

  if (typeName === "ZodBoolean") {
    return { type: "boolean", description: schema.description };
  }

  if (typeName === "ZodArray") {
    return {
      type: "array",
      items: zodTypeToJsonSchema(schema._def.type),
      description: schema.description,
    };
  }

  if (typeName === "ZodObject") {
    const shape = typeof schema._def.shape === "function" ? schema._def.shape() : schema._def.shape || {};
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodTypeToJsonSchema(value);
      const valType = (value as any)._def?.typeName;
      if (valType !== "ZodOptional" && valType !== "ZodDefault") {
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

  return { type: "string" };
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
