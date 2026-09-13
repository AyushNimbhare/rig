import chalk, { Chalk } from "chalk";
import type { AgentResult, ToolObservation } from "../core/agent-types.js";
import type { ModelSource } from "../core/model-factory.js";
import { VERSION } from "../version.js";

export type AskResult = {
  message: string;
  observations: Array<{ tool: string; result: unknown }>;
  sessionId: string;
};

// ── Theme ──────────────────────────────────────────────────────────────────────

export function createTheme(noColor = false) {
  const c = noColor ? new Chalk({ level: 0 }) : chalk;
  return {
    brand:         (v: string) => c.hex("#c084fc").bold(v),
    hot:           (v: string) => c.hex("#e879f9").bold(v),
    magenta:       (v: string) => c.hex("#d946ef")(v),
    accent:        (v: string) => c.hex("#a855f7")(v),
    dim:           (v: string) => c.hex("#3b2d54")(v),
    muted:         (v: string) => c.hex("#8e85aa")(v),
    text:          (v: string) => c.hex("#e9ddff")(v),
    userText:      (v: string) => c.bold.white(v),
    border:        (v: string) => c.hex("#a855f7")(v),
    borderBright:  (v: string) => c.hex("#c084fc")(v),
    button:        (v: string) => c.bgHex("#a855f7").hex("#ffffff").bold(v),
    glow:          (v: string) => c.hex("#7c2dff")(v),
    scanline:      (v: string) => c.hex("#581c87")(v),
    scanlineHot:   (v: string) => c.hex("#f472b6")(v),
    trafficRed:    (v: string) => c.hex("#ef4444")(v),
    trafficYellow: (v: string) => c.hex("#eab308")(v),
    trafficGreen:  (v: string) => c.hex("#22c55e")(v),
    success:       (v: string) => c.hex("#a855f7")(v),
    error:         (v: string) => c.hex("#f87171")(v),
    warn:          (v: string) => c.hex("#fbbf24")(v),
    cyan:          (v: string) => c.hex("#38bdf8")(v),
    label:         (v: string) => c.hex("#8e85aa").italic(v),
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────────

export function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "").replace(/\u001b\(B/g, "");
}

export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

export function shortPath(workspace: string): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "";
  if (home && workspace.startsWith(home)) return "~" + workspace.slice(home.length);
  return workspace;
}

export function center(value: string, width: number): string {
  const size = visibleLength(value);
  if (size >= width) return value;
  return " ".repeat(Math.floor((width - size) / 2)) + value;
}

export function fit(value: string, width: number): string {
  const size = visibleLength(value);
  if (size === width) return value;
  if (size < width) return value + " ".repeat(width - size);
  let out = "";
  let vis = 0;
  let ansi = false;
  let esc = "";
  for (const ch of value) {
    if (ch === "\u001b") ansi = true;
    if (ansi) {
      esc += ch;
      if (/[a-zA-Z\u0007]/.test(ch)) {
        out += esc;
        ansi = false;
        esc = "";
      } else {
        out += "";
      }
      continue;
    }
    if (vis >= width) break;
    out += ch;
    vis++;
  }
  return out;
}

export function getTerminalDimensions(output?: { columns?: number; rows?: number }): { columns: number; rows: number } {
  const cols = output?.columns ?? process.stdout.columns;
  const rowsVal = output?.rows ?? process.stdout.rows;
  return {
    columns: Math.max(80, cols || 100),
    rows: Math.max(24, rowsVal || 30),
  };
}

function truncate(value: string, max = 80): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

function formatObservation(value: unknown, maxLen = 65): string {
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if ("content" in obj && typeof obj["content"] === "string") {
      return truncate(obj["content"], maxLen);
    }
    if ("stdout" in obj && typeof obj["stdout"] === "string") {
      return truncate(obj["stdout"] || (obj["stderr"] as string) || "Done", maxLen);
    }
    if ("message" in obj && typeof obj["message"] === "string") {
      return truncate(obj["message"], maxLen);
    }
  }
  if (Array.isArray(value)) {
    const joined = value.join(", ");
    return truncate(joined || "∅", maxLen);
  }
  return truncate(String(value), maxLen);
}

// ── Cyberpunk Ambient Glitch Particles ─────────────────────────────────────────

export function generateScanline(
  width: number,
  row: number,
  isGlitchFrame: boolean,
  theme: ReturnType<typeof createTheme>,
): string {
  const chars = Array.from({ length: width }, () => " ");
  const leftBand = Math.min(28, Math.floor(width * 0.28));
  const rightBandStart = Math.max(0, width - leftBand);

  const seed = (row * 37 + 19) % 100;

  for (let x = 0; x < leftBand; x++) {
    const v = (x * 13 + row * 29 + seed) % 43;
    if (v === 1 || v === 5) chars[x] = "-";
    else if (v === 9) chars[x] = ".";
    else if (v === 17) chars[x] = ":";
    else if (v === 23 && x % 4 === 0) chars[x] = "·";
    else if (isGlitchFrame && (v === 11 || v === 27)) chars[x] = "░";
  }

  for (let x = rightBandStart; x < width; x++) {
    const v = ((width - x) * 17 + row * 31 + seed) % 41;
    if (v === 2 || v === 7) chars[x] = "-";
    else if (v === 11) chars[x] = ".";
    else if (v === 19) chars[x] = ":";
    else if (v === 29 && x % 3 === 0) chars[x] = "·";
    else if (isGlitchFrame && (v === 13 || v === 33)) chars[x] = "▒";
  }

  if (isGlitchFrame && (row % 3 === 0 || row % 5 === 0)) {
    const start = row % 2 === 0 ? 3 : Math.max(0, width - 22);
    const len = 8 + (row % 12);
    for (let x = start; x < Math.min(width, start + len); x++) {
      if (x % 2 === 0) chars[x] = "▓";
    }
  }

  const raw = chars.join("");
  return isGlitchFrame ? theme.scanlineHot(raw) : theme.scanline(raw);
}

// ── Top Bar ────────────────────────────────────────────────────────────────────

export function renderTopBar(workspace: string, noColor: boolean, columns: number): string {
  const theme = createTheme(noColor);
  const ws = shortPath(workspace);

  const traffic = `${theme.trafficRed("●")} ${theme.trafficYellow("●")} ${theme.trafficGreen("●")}`;
  const pillTraffic = `${theme.border("[")} ${traffic} ${theme.border("]")}`;
  const pillBrand = `${theme.border("[")} ${theme.brand("rig")} ${theme.muted(`v${VERSION}`)} ${theme.border("]")}`;
  const pillWs = `${theme.border("[")} ${theme.accent(ws)} ${theme.border("]")}`;
  const pillPlus = `${theme.border("[")} ${theme.accent("+")} ${theme.border("]")}`;
  const leftGroup = `${pillTraffic}  ${pillBrand}  ${pillWs}  ${pillPlus}`;

  const rightToggle = `${theme.border("[")} ${theme.accent("⌘K")} ${theme.muted("to toggle")} ${theme.border("]")}`;

  const gap = Math.max(1, columns - visibleLength(leftGroup) - visibleLength(rightToggle) - 2);
  return " " + leftGroup + " ".repeat(gap) + rightToggle;
}

// ── Logo ───────────────────────────────────────────────────────────────────────

export function renderLogo(isGlitch: boolean, noColor: boolean): string[] {
  const theme = createTheme(noColor);

  const lines = [
    "   ██████╗  ██╗  ██████╗  ",
    "   ██╔══██╗ ██║ ██╔════╝  ",
    "   ██████╔╝ ██║ ██║  ███╗ ",
    "   ██╔══██╗ ██║ ██║   ██║ ",
    "   ██║  ██║ ██║ ╚██████╔╝ ",
    "   ╚═╝  ╚═╝ ╚═╝  ╚═════╝  ",
  ];

  const colors = [
    theme.hot,
    theme.magenta,
    theme.brand,
    theme.accent,
    theme.glow,
    theme.dim,
  ];

  return lines.map((line, idx) => {
    const baseColor = colors[idx] ?? theme.accent;
    let rendered = baseColor(line);

    const leftStreak = idx % 2 === 0 ? "── " : "   ";
    const rightStreak = idx % 2 === 0 ? " ──" : "   ";

    if (isGlitch && (idx === 1 || idx === 3)) {
      rendered = theme.scanlineHot(line.replace(/█/g, "▓"));
    }

    return theme.dim(leftStreak) + rendered + theme.dim(rightStreak);
  });
}

// ── Boxed Input Component ──────────────────────────────────────────────────────

export type InputBoxRender = {
  lines: string[];
  promptRowOffset: number;
  promptCol: number;
};

export function renderInputBox(
  inputBuffer: string,
  cursorPos: number,
  columns: number,
  noColor = false,
  boxWidthOverride?: number,
  modelName?: string,
): InputBoxRender {
  const theme = createTheme(noColor);
  const boxWidth = boxWidthOverride ?? Math.min(84, Math.max(56, columns - 12));
  const leftPad = Math.max(2, Math.floor((columns - boxWidth) / 2));
  const pad = " ".repeat(leftPad);

  const innerContentWidth = boxWidth - 2;
  const textPadding = 2;
  const usableWidth = innerContentWidth - textPadding * 2;

  const topBorder = pad + theme.border("╭" + "─".repeat(innerContentWidth) + "╮");
  const bottomBorder = pad + theme.border("╰" + "─".repeat(innerContentWidth) + "╯");

  const placeholderText = "Ask Rig anything... (⌘K to toggle)";
  const space1 = Math.max(0, usableWidth - visibleLength(placeholderText));
  const headerLine =
    pad +
    theme.border("│") +
    " ".repeat(textPadding) +
    theme.muted(placeholderText) +
    " ".repeat(space1) +
    " ".repeat(textPadding) +
    theme.border("│");

  const spacerLine = pad + theme.border("│") + " ".repeat(innerContentWidth) + theme.border("│");

  const promptSymbol = "› ";
  const promptSymbolLen = 2;

  const navHint = "↑↓ to navigate";
  const enterHint = "↵ to send";
  const button = theme.button(" → ");
  const controlsLen = visibleLength(`${navHint}   ${enterHint}   [→]`);
  const controlsFormatted = `${theme.muted(navHint)}   ${theme.muted(enterHint)}   ${button}`;

  let spaceForInput = usableWidth - promptSymbolLen - controlsLen;
  let showFullControls = true;

  if (spaceForInput < visibleLength(inputBuffer) + 2) {
    const compactControlsLen = visibleLength(" [→]");
    if (usableWidth - promptSymbolLen - compactControlsLen > visibleLength(inputBuffer)) {
      showFullControls = false;
    }
  }

  const activeControlsText = showFullControls ? controlsFormatted : button;
  const activeControlsLen = showFullControls ? controlsLen : visibleLength("[→]");

  const maxInputVisible = Math.max(0, usableWidth - promptSymbolLen - activeControlsLen - 1);
  let displayInput = inputBuffer;
  let displayCursorOffset = cursorPos;
  if (visibleLength(inputBuffer) > maxInputVisible && maxInputVisible > 0) {
    if (cursorPos <= maxInputVisible - 1) {
      displayInput = inputBuffer.slice(0, maxInputVisible - 1) + "…";
      displayCursorOffset = Math.min(cursorPos, visibleLength(displayInput));
    } else if (cursorPos >= visibleLength(inputBuffer) - (maxInputVisible - 1)) {
      const tail = inputBuffer.slice(-(maxInputVisible - 1));
      displayInput = "…" + tail;
      displayCursorOffset = visibleLength(displayInput) - (visibleLength(inputBuffer) - cursorPos);
    } else {
      const half = Math.floor((maxInputVisible - 2) / 2);
      const start = Math.max(0, cursorPos - half);
      displayInput = "…" + inputBuffer.slice(start, start + maxInputVisible - 2) + "…";
      displayCursorOffset = visibleLength(displayInput) - (maxInputVisible - half - 1);
    }
  } else if (visibleLength(inputBuffer) > maxInputVisible) {
    displayInput = inputBuffer.slice(0, maxInputVisible);
    displayCursorOffset = Math.min(cursorPos, maxInputVisible);
  }

  const spaceBetween = Math.max(
    1,
    usableWidth - promptSymbolLen - visibleLength(displayInput) - activeControlsLen,
  );

  const inputLine =
    pad +
    theme.border("│") +
    " ".repeat(textPadding) +
    theme.accent(promptSymbol) +
    theme.userText(displayInput) +
    " ".repeat(spaceBetween) +
    activeControlsText +
    " ".repeat(textPadding) +
    theme.border("│");

  const footerText = `${theme.muted("Type")} ${theme.brand("/help")} ${theme.muted("for commands")}  ${theme.dim("•")}  ${theme.brand("/clear")} ${theme.muted("to reset")}  ${theme.dim("•")}  ${theme.brand("/exit")} ${theme.muted("to quit")}`;
  const footerLine = center(footerText, columns);

  // Model status line shown under the textbox
  const statusLeft = theme.muted("model") + " " + (modelName ? theme.brand(modelName) : theme.warn("not configured"));
  const statusRight = theme.muted("/status for details") ;
  const statusGap = Math.max(1, columns - visibleLength(statusLeft) - visibleLength(statusRight) - 2);
  const modelLine = " " + statusLeft + " ".repeat(statusGap) + statusRight;

  const lines = [
    topBorder,
    headerLine,
    spacerLine,
    inputLine,
    bottomBorder,
    "",
    modelLine,
    footerLine,
  ];

  const promptCol = leftPad + 1 + textPadding + promptSymbolLen + 1 + displayCursorOffset - cursorPos;
  const promptRowOffset = 3;

  return {
    lines,
    promptRowOffset,
    promptCol,
  };
}

// ── Onboarding Setup Screen ───────────────────────────────────────────────────

export function renderSetupScreen(
  workspace: string,
  inputBuffer: string,
  cursorPos: number,
  options: { noColor?: boolean } = {},
): WelcomeScreenResult {
  const theme = createTheme(options.noColor);
  const { columns, rows } = getTerminalDimensions();
  const ws = shortPath(workspace);

  const boxWidth = Math.min(84, Math.max(56, columns - 12));
  const leftPad = Math.max(2, Math.floor((columns - boxWidth) / 2));
  const pad = " ".repeat(leftPad);

  const innerContentWidth = boxWidth - 2;
  const textPadding = 2;
  const usableWidth = innerContentWidth - textPadding * 2;

  const topBorder = pad + theme.borderBright("╭" + "─".repeat(innerContentWidth) + "╮");
  const bottomBorder = pad + theme.borderBright("╰" + "─".repeat(innerContentWidth) + "╯");

  const headerTitle = "✨ Initialize RIG Workspace";
  const space0 = Math.max(0, usableWidth - visibleLength(headerTitle));
  const line0 =
    pad +
    theme.borderBright("│") +
    " ".repeat(textPadding) +
    theme.hot(headerTitle) +
    " ".repeat(space0) +
    " ".repeat(textPadding) +
    theme.borderBright("│");

  const subtitle = `Set up .rig/ config, instructions & gitignore for ${ws}?`;
  const space1 = Math.max(0, usableWidth - visibleLength(subtitle));
  const line1 =
    pad +
    theme.borderBright("│") +
    " ".repeat(textPadding) +
    theme.text(subtitle) +
    " ".repeat(space1) +
    " ".repeat(textPadding) +
    theme.borderBright("│");

  const spacer = pad + theme.borderBright("│") + " ".repeat(innerContentWidth) + theme.borderBright("│");

  const promptText = "› Initialize RIG? [Y/n] ";
  const promptLen = visibleLength(promptText);
  const hintText = `${theme.muted("↵ confirm")}   ${theme.muted("n to skip")}   ${theme.button(" Y ")}`;
  const hintLen = visibleLength("↵ confirm   n to skip   [Y]");

  const spacePrompt = Math.max(1, usableWidth - promptLen - visibleLength(inputBuffer) - hintLen);
  const promptLine =
    pad +
    theme.borderBright("│") +
    " ".repeat(textPadding) +
    theme.accent(promptText) +
    theme.userText(inputBuffer) +
    " ".repeat(spacePrompt) +
    hintText +
    " ".repeat(textPadding) +
    theme.borderBright("│");

  const footerText = `${theme.muted("Press")} ${theme.brand("Enter")} ${theme.muted("to initialize")}  ${theme.dim("•")}  ${theme.muted("Press")} ${theme.brand("n")} ${theme.muted("to skip setup")}`;
  const footerLine = center(footerText, columns);

  const boxLines = [
    topBorder,
    line0,
    line1,
    spacer,
    promptLine,
    bottomBorder,
    "",
    footerLine,
  ];

  const lines: string[] = [];
  lines.push(renderTopBar(workspace, Boolean(options.noColor), columns));
  lines.push(theme.dim("─".repeat(columns)));

  const logo = renderLogo(false, Boolean(options.noColor));
  const logoHeight = logo.length + 2;
  const boxHeight = boxLines.length;
  const totalContentHeight = 2 + logoHeight + boxHeight;
  const availablePadding = Math.max(2, rows - totalContentHeight);

  const topScanlineCount = Math.max(1, Math.floor(availablePadding * 0.4));
  const bottomScanlineCount = Math.max(1, availablePadding - topScanlineCount);

  for (let r = 0; r < topScanlineCount; r++) {
    lines.push(generateScanline(columns, r, false, theme));
  }

  for (const logoLine of logo) {
    lines.push(center(logoLine, columns));
  }
  lines.push(center(theme.muted(`v${VERSION}`), columns));
  lines.push(center(theme.accent(ws), columns));

  for (let r = 0; r < bottomScanlineCount; r++) {
    lines.push(generateScanline(columns, r + topScanlineCount, false, theme));
  }

  const startBoxRowIndex = lines.length;
  lines.push(...boxLines);

  const cursorCol = leftPad + 1 + textPadding + promptLen + 1 + cursorPos;
  const cursorRow = startBoxRowIndex + 5; // 5th row in boxLines (promptLine)

  return {
    screenContent: lines.join("\n"),
    cursorRow,
    cursorCol,
  };
}

// ── Full Welcome Screen ────────────────────────────────────────────────────────

export type WelcomeScreenResult = {
  screenContent: string;
  cursorRow: number;
  cursorCol: number;
};

export function renderStatus(
  workspace: string,
  provider: { provider: string; baseUrl?: string; apiCompat?: string } | undefined,
  model: string | undefined,
  noColor = false,
): string {
  const theme = createTheme(noColor);
  const ws = shortPath(workspace);
  const providerLabel = provider ? `${provider.provider}${provider.baseUrl ? ` (${provider.baseUrl})` : ""}${provider.apiCompat ? ` [${provider.apiCompat}]` : ""}` : "not configured";
  const modelLabel = model ?? "not configured";
  return [
    "",
    `  ${theme.brand("RIG STATUS")}`,
    `  ${theme.dim("─".repeat(40))}`,
    `    ${theme.accent("workspace")}  ${theme.text(ws)}`,
    `    ${theme.accent("provider")}   ${provider ? theme.text(providerLabel) : theme.warn(providerLabel)}`,
    `    ${theme.accent("model")}      ${model ? theme.text(modelLabel) : theme.warn(modelLabel)}`,
    "",
    `  ${theme.dim(provider ? "Use /provider to switch provider, /model to switch model." : "Use /provider to link a provider, then /model to pick a model.")}`,
    "",
  ].join("\n");
}

export function renderWelcomeScreen(
  workspace: string,
  inputBuffer: string,
  cursorPos: number,
  isGlitch: boolean,
  options: { noColor?: boolean; modelName?: string } = {},
): WelcomeScreenResult {
  const theme = createTheme(options.noColor);
  const { columns, rows } = getTerminalDimensions();
  const ws = shortPath(workspace);

  const lines: string[] = [];

  // 1. Top bar
  lines.push(renderTopBar(workspace, Boolean(options.noColor), columns));
  lines.push(theme.dim("─".repeat(columns)));

  // 2. Space above logo (scanlines)
  const logo = renderLogo(isGlitch, Boolean(options.noColor));
  const logoHeight = logo.length + 2;
  const boxHeight = 8;
  const totalContentHeight = 2 + logoHeight + boxHeight;
  const availablePadding = Math.max(2, rows - totalContentHeight);

  const topScanlineCount = Math.max(1, Math.floor(availablePadding * 0.4));
  const bottomScanlineCount = Math.max(1, availablePadding - topScanlineCount);

  for (let r = 0; r < topScanlineCount; r++) {
    lines.push(generateScanline(columns, r, isGlitch, theme));
  }

  // 3. Centered Logo
  for (const logoLine of logo) {
    lines.push(center(logoLine, columns));
  }
  lines.push(center(theme.muted(`v${VERSION}`), columns));
  lines.push(center(theme.accent(ws), columns));

  // 4. Space between logo and box (scanlines)
  for (let r = 0; r < bottomScanlineCount; r++) {
    lines.push(generateScanline(columns, r + topScanlineCount, isGlitch, theme));
  }

  // 5. Input Box
  const startBoxRowIndex = lines.length;
  const box = renderInputBox(inputBuffer, cursorPos, columns, Boolean(options.noColor), undefined, options.modelName);
  lines.push(...box.lines);

  const cursorRow = startBoxRowIndex + box.promptRowOffset + 1;
  const cursorCol = box.promptCol + cursorPos;

  return {
    screenContent: lines.join("\n"),
    cursorRow,
    cursorCol,
  };
}

// ── Conversation Turn Rendering ────────────────────────────────────────────────

export function renderUserMessage(message: string, options: { noColor?: boolean } = {}): string {
  const theme = createTheme(options.noColor);
  return `  ${theme.accent("❯")} ${theme.userText(message)}`;
}

export function renderTurn(result: AgentResult | AskResult, options: { noColor?: boolean } = {}): string[] {
  const theme = createTheme(options.noColor);
  const lines: string[] = [];

  lines.push("");
  lines.push(`  ${theme.label("assistant")}`);
  lines.push("");

  for (const line of result.message.split("\n")) {
    lines.push(`  ${theme.text(line)}`);
  }

  const observations = (result as any).observations as ToolObservation[] | Array<{ tool: string; result: unknown }>;
  if (observations && observations.length > 0) {
    lines.push("");
    for (const obs of observations) {
      const rendered = formatObservation(obs.result);
      const icon = (obs as any).ok === false ? theme.error("✗") : theme.dim("◆");
      lines.push(`  ${icon} ${theme.accent(obs.tool)} ${theme.dim("·")} ${theme.muted(rendered)}`);
    }
  }

  const filesChanged = (result as any).filesChanged as string[] | undefined;
  if (filesChanged && filesChanged.length > 0) {
    lines.push("");
    lines.push(`  ${theme.cyan("▲")} ${theme.muted("Files changed:")} ${theme.brand(filesChanged.join(", "))}`);
  }

  lines.push("");
  return lines;
}

export function renderAsk(result: AgentResult | AskResult, options: { noColor?: boolean; json?: boolean } = {}): string {
  if (options.json) return JSON.stringify(result, null, 2);
  const theme = createTheme(options.noColor);
  const lines = [
    ...renderTurn(result, options),
    `  ${theme.dim("session")} ${theme.dim(result.sessionId)}`,
    "",
  ];
  return lines.join("\n");
}

// ── Help & Errors ──────────────────────────────────────────────────────────────

export function renderHelp(noColor = false): string {
  const theme = createTheme(noColor);
  return [
    "",
    `  ${theme.brand("RIG COMMANDS")}`,
    `  ${theme.dim("─".repeat(40))}`,
    `    ${theme.accent("/help")}     ${theme.muted("Show this help message")}`,
    `    ${theme.accent("/status")}   ${theme.muted("Show provider & model status")}`,
    `    ${theme.accent("/provider")} ${theme.muted("Link an AI model provider")}`,
    `    ${theme.accent("/model")}    ${theme.muted("Choose an AI model")}`,
    `    ${theme.accent("/clear")}    ${theme.muted("Reset conversation and screen")}`,
    `    ${theme.accent("/quit")}     ${theme.muted("Exit RIG harness")}`,
    `    ${theme.accent("/exit")}     ${theme.muted("Exit RIG harness")}`,
    "",
  ].join("\n");
}

export function renderError(error: unknown, noColor = false): string {
  const theme = createTheme(noColor);
  const msg = error instanceof Error ? error.message : String(error);
  return `\n  ${theme.error("✗")} ${theme.error("error")} ${theme.dim("·")} ${msg}\n`;
}

/**
 * Warning shown when a run produced no real model output. Printed to stderr so
 * that `--json` output on stdout stays parseable.
 */
export function renderOfflineWarning(source: ModelSource | undefined, noColor = false): string {
  const theme = createTheme(noColor);
  const cause =
    source === "mock"
      ? "the configured provider could not be used"
      : "no model provider is configured";
  return (
    `\n  ${theme.warn("⚠")} ${theme.warn("no model output")} ${theme.dim("·")} ${cause}, ` +
    `so the answer above is a scripted placeholder, not a real reply.\n`
  );
}

export function renderGoodbye(noColor = false): string {  const theme = createTheme(noColor);
  return `\n  ${theme.dim("RIG terminated. Goodbye.")}\n`;
}
