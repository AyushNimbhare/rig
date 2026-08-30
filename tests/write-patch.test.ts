import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyUnifiedDiff, extractTargetFilesFromPatch, writePatchTool } from "../src/tools/write-patch.js";

describe("write_patch Tool", () => {
  it("extracts target files from patch", () => {
    const patch = `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;`;

    const files = extractTargetFilesFromPatch(patch);
    expect(files).toEqual(["src/index.ts"]);
  });

  it("applies unified diff correctly to file content", () => {
    const original = "line1\nline2\nline3\n";
    const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+line2_updated
 line3
`;

    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe("line1\nline2_updated\nline3\n");
  });

  it("applies patch to files in workspace", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-patch-test-"));
    const filePath = path.join(tmpDir, "hello.txt");
    await writeFile(filePath, "Hello World\nGoodbye World\n", "utf8");

    const patch = `--- a/hello.txt
+++ b/hello.txt
@@ -1,2 +1,2 @@
 Hello World
-Goodbye World
+Hello RIG
`;

    const result = (await writePatchTool.execute(
      { patch, reason: "Update greeting" },
      { workspace: tmpDir },
    )) as any;

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(["hello.txt"]);

    const updated = await readFile(filePath, "utf8");
    expect(updated).toContain("Hello RIG");
  });

  it("rejects path traversal outside workspace boundary", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "rig-patch-test-"));
    const patch = `--- a/../secret.txt
+++ b/../secret.txt
@@ -1,1 +1,1 @@
-old
+new`;

    await expect(
      writePatchTool.execute({ patch }, { workspace: tmpDir }),
    ).rejects.toThrow("outside workspace boundary");
  });
});
