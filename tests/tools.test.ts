import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import { gitStatus } from "../src/tools/git.js";
import { listFiles } from "../src/tools/read-only.js";

describe("ToolRegistry", () => {
  it("registers and exposes typed tools", () => {
    const registry = new ToolRegistry();
    registry.register(listFiles); registry.register(gitStatus);
    expect(registry.get("list_files").name).toBe("list_files");
    expect(registry.definitions()).toHaveLength(2);
  });
});
