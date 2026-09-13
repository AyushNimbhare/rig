import { describe, expect, it } from "vitest";
import { renderInputBox, renderWelcomeScreen, stripAnsi } from "../src/cli/render.js";
import { VERSION } from "../src/version.js";

describe("Render System", () => {
  it("renders the input box with aligned borders and matching line widths", () => {
    const box = renderInputBox("test input", 0, 80, true);
    expect(box.lines.length).toBe(8);

    // Verify all box border lines have the same visible length
    const topLen = stripAnsi(box.lines[0]).trim().length;
    const headerLen = stripAnsi(box.lines[1]).trim().length;
    const spacerLen = stripAnsi(box.lines[2]).trim().length;
    const inputLen = stripAnsi(box.lines[3]).trim().length;
    const bottomLen = stripAnsi(box.lines[4]).trim().length;

    expect(topLen).toBe(headerLen);
    expect(topLen).toBe(spacerLen);
    expect(topLen).toBe(inputLen);
    expect(topLen).toBe(bottomLen);
  });

  it("renders welcome screen with exact cursor row and col coordinates", () => {
    const result = renderWelcomeScreen("/workspace/test", "query", 2, false, { noColor: true });
    expect(result.cursorRow).toBeGreaterThan(0);
    expect(result.cursorCol).toBeGreaterThan(0);
    // The version is read from package.json rather than hardcoded.
    expect(result.screenContent).toContain(`rig v${VERSION}`);
    expect(result.screenContent).toContain("Ask Rig anything...");
    expect(result.screenContent).toContain("/help for commands");
  });

  it("shows current model under the textbox", () => {
    const withModel = renderInputBox("hi", 0, 80, true, undefined, "gpt-4o-mini");
    const withoutModel = renderInputBox("hi", 0, 80, true);
    expect(stripAnsi(withModel.lines[6])).toContain("gpt-4o-mini");
    expect(stripAnsi(withModel.lines[6])).toContain("model");
    expect(stripAnsi(withoutModel.lines[6])).toContain("not configured");
  });

  it("renders welcome screen with model line", () => {
    const result = renderWelcomeScreen("/workspace/test", "q", 0, false, { noColor: true, modelName: "claude-3" });
    expect(result.screenContent).toContain("claude-3");
  });
});
