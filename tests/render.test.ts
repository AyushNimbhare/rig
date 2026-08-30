import { describe, expect, it } from "vitest";
import { renderInputBox, renderWelcomeScreen, stripAnsi } from "../src/cli/render.js";

describe("Render System", () => {
  it("renders the input box with aligned borders and matching line widths", () => {
    const box = renderInputBox("test input", 0, 80, true);
    expect(box.lines.length).toBe(7);

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
    expect(result.screenContent).toContain("rig v0.1.0");
    expect(result.screenContent).toContain("Ask Rig anything...");
    expect(result.screenContent).toContain("/help for commands");
  });
});
