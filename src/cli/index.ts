#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { initializeMcuWorkspace, isMcuWorkspaceSetup } from "../config/mcu-setup.js";
import {
  PROVIDERS,
  fetchAvailableModels,
  loadModelConfig,
  loadProviderConfig,
  saveModelConfig,
  saveProviderConfig,
  type AvailableModel,
} from "../config/provider-setup.js";
import { isWorkspaceSetup, setupWorkspace } from "../config/workspace-setup.js";
import { runAgentLoop } from "../core/agent-loop.js";
import type { AgentResult, ApprovalRequest } from "../core/agent-types.js";
import {
  createTheme,
  renderAsk,
  renderError,
  renderGoodbye,
  renderHelp,
  renderInputBox,
  renderSetupScreen,
  renderStatus,
  renderTurn,
  renderUserMessage,
  renderWelcomeScreen,
} from "./render.js";
import { fuzzyFilter } from "./fuzzy.js";
import {
  buildReviewTask,
  collectConfig,
  collectReviewDiff,
  collectSessionDetail,
  collectSessions,
  findResumableSession,
  renderConfig,
  renderReviewHeader,
  renderSessionDetail,
  renderSessionList,
} from "./commands.js";
import { VERSION } from "../version.js";

const COMMANDS: Array<[string, string]> = [
  ["/status", "Show provider & model status"],
  ["/provider", "Link an AI provider"],
  ["/model", "Choose an AI model"],
  ["/help", "Show available commands"],
  ["/clear", "Reset the conversation"],
  ["/exit", "Exit RIG"],
  ["/quit", "Exit RIG"],
];

async function requestTerminalApproval(req: ApprovalRequest, noColor = false): Promise<boolean> {
  const theme = createTheme(noColor);
  // Ensure we are in cooked mode for readline question
  let needRestoreRaw = false;
  try {
    if (input.isTTY && typeof (input as any).setRawMode === "function") {
      try {
        const cur = (input as any).isRaw;
        if (cur) {
          (input as any).setRawMode(false);
          needRestoreRaw = true;
        }
      } catch {}
    }
    output.write("\u001b[r");
    console.log(`\n  ${theme.warn("⚠")} ${theme.warn("Permission Required")}`);
    console.log(`  ${theme.muted("Action:")}  ${theme.brand(req.tool)}`);
    if (req.reason) {
      console.log(`  ${theme.muted("Reason:")}  ${req.reason}`);
    }
    if (req.arguments["command"]) {
      console.log(`  ${theme.muted("Command:")} ${theme.accent(String(req.arguments["command"]))}`);
    }
    if (req.arguments["patch"]) {
      const patchPreview = String(req.arguments["patch"]).split("\n").slice(0, 5).join("\n    ");
      console.log(`  ${theme.muted("Patch:")}\n    ${theme.dim(patchPreview)}...`);
    }

    const rl = readline.createInterface({ input, output });
    try {
      const answer = await new Promise<string>((resolve) => {
        rl.question(`\n  ${theme.accent("Approve? [y/N]:")} `, (ans) => resolve(ans.trim()));
      });
      return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
    } finally {
      rl.close();
    }
  } finally {
    if (needRestoreRaw) {
      try { (input as any).setRawMode(true); } catch {}
    }
  }
}

export async function runTask(
  task: string,
  options: {
    workspace?: string;
    model?: string;
    maxSteps?: number;
    autoApprove?: boolean;
    noColor?: boolean;
    resumeSessionId?: string;
  } = {},
): Promise<AgentResult> {
  const workspace = path.resolve(options.workspace || process.cwd());

  return runAgentLoop({
    task,
    workspace,
    model: options.model,
    maxSteps: options.maxSteps,
    autoApprove: options.autoApprove,
    resumeSessionId: options.resumeSessionId,
    onApprovalRequest: async (req) => requestTerminalApproval(req, options.noColor),
  });
}

export function runInteractive(workspace = process.cwd(), noColor = false): Promise<void> {
  return new Promise<void>(async (resolve) => {
    // Non-interactive stdin (pipes, CI, `echo ... | rig`): run a plain
    // line-oriented REPL and never paint the full-screen TUI.
    if (!input.isTTY) {
      const rl = readline.createInterface({ input, output });
      try {
        for await (const line of rl) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === "/quit" || trimmed === "/exit") break;
          if (trimmed === "/help") {
            console.log(renderHelp(noColor));
            continue;
          }
          const result = await runTask(trimmed, { workspace, noColor });
          console.log(renderAsk(result, { noColor }));
        }
      } finally {
        rl.close();
        resolve();
      }
      return;
    }

    const isAlreadySetup = await isWorkspaceSetup(workspace);
    let inSetupMode = !isAlreadySetup;
    let inputBuffer = "";
    let cursorPos = 0;
    let inConversation = false;
    let lastTypingTime = 0;
    let glitchInterval: NodeJS.Timeout | undefined;
    let glitchRestoreTimeout: NodeJS.Timeout | undefined;
    let isExiting = false;
    let conversationBoxVisible = false;
    let conversationLayoutActive = false;
    let conversationContentBottom = 0;
    let conversationBoxTop = 0;
    let commandPopupHeight = 0;
    let providerMode = false;
    let providerApiMode = false;
    let providerCustomStage: "compat" | "baseUrl" | "apiKey" | null = null;
    let providerTempCompat: "openai" | "anthropic" = "openai";
    let providerTempBaseUrl = "";
    let providerCompatIndex = 0;
    let providerIndex = 0;
    let providerOverlayTop = 0;
    let providerOverlayHeight = 0;
    let modelMode = false;
    let modelIndex = 0;
    let modelOptions: AvailableModel[] = [];
    let modelLoading = false;
    let modelSearch = "";
    let modelScrollOffset = 0;
    let commandFilter = "";
    let commandSelectionIndex = 0;
    let currentModel: string | undefined = undefined;

    async function refreshCurrentModel(): Promise<void> {
      try {
        const providerConfig = await loadProviderConfig(workspace);
        const modelFromFile = await loadModelConfig(workspace);
        currentModel = modelFromFile || providerConfig?.model || process.env["RIG_MODEL"] || undefined;
      } catch { currentModel = undefined; }
    }
    // initial load (non-blocking, then redraw)
    refreshCurrentModel().then(() => { if (!inConversation && !isExiting && !inSetupMode) drawScreen(false); }).catch(() => {});

    async function printStatus(): Promise<void> {
      const provider = await loadProviderConfig(workspace);
      const model = (await loadModelConfig(workspace)) || provider?.model || process.env["RIG_MODEL"];
      const out = renderStatus(workspace, provider as any, model, noColor);
      // print in scrollable area so it stays in history
      if (inConversation) {
        // ensure we are in scroll region before printing
        output.write("\u001b[r");
        console.log(out);
        drawConversationInput();
      } else {
        output.write("\u001b[r");
        console.clear();
        console.log(out);
        drawScreen(false);
      }
    }

    function drawScreen(isGlitch = false) {
      if (inConversation || isExiting) return;

      if (inSetupMode) {
        const { screenContent, cursorRow, cursorCol } = renderSetupScreen(
          workspace,
          inputBuffer,
          cursorPos,
          { noColor },
        );
        output.write(`\u001b[H\u001b[J${screenContent}`);
        output.write(`\u001b[${cursorRow};${cursorCol}H\u001b[?25h`);
        return;
      }

      const { screenContent, cursorRow, cursorCol } = renderWelcomeScreen(
        workspace,
        inputBuffer,
        cursorPos,
        isGlitch,
        { noColor, modelName: currentModel },
      );
      output.write(`\u001b[H\u001b[J${screenContent}`);
      output.write(`\u001b[${cursorRow};${cursorCol}H\u001b[?25h`);
      drawHomeCommandPopup(cursorRow, cursorCol);
    }

    function drawConversationInput() {
      if (!inConversation || isExiting) return;

      // Force scroll layout BEFORE rendering to avoid shifting lines under us
      if (!conversationLayoutActive) {
        const rows = Math.max(24, output.rows || 30);
        conversationContentBottom = Math.max(1, rows - 8);
        conversationBoxTop = conversationContentBottom + 1;
        output.write(`\u001b[1;${conversationContentBottom}r`);
        output.write(`\u001b[${conversationContentBottom};1H`);
        conversationLayoutActive = true;
      }

      const box = renderInputBox(
        inputBuffer,
        cursorPos,
        output.columns || 100,
        noColor,
        Math.floor((output.columns || 100) * 0.9),
        currentModel,
      );
      const firstRender = !conversationBoxVisible;

      if (firstRender) {
        for (const [index, line] of box.lines.entries()) {
          output.write(`\u001b[${conversationBoxTop + index};1H\u001b[2K${line}`);
        }
        conversationBoxVisible = true;
      } else {
        for (const [index, line] of box.lines.entries()) {
          output.write(`\u001b[${conversationBoxTop + index};1H\u001b[2K${line}`);
        }
      }
      output.write(
        `\u001b[${conversationBoxTop + box.promptRowOffset};${box.promptCol + cursorPos}H\u001b[?25h`,
      );
      drawCommandPopup(box);
    }

    function drawCommandPopup(box: ReturnType<typeof renderInputBox>) {
      const query = commandFilter || inputBuffer.toLowerCase();
      const matches = query.startsWith("/")
        ? fuzzyFilter(COMMANDS, query, ([command]) => command)
        : [];
      const popupLines = matches.length > 0
        ? [
            "Commands",
            ...matches.map(([command, description], index) =>
              `${index === commandSelectionIndex ? "❯" : " "} ${command.padEnd(11)} ${description}`),
          ]
        : [];
      const popupHeight = popupLines.length + 2;
      const popupTop = Math.max(1, conversationBoxTop - popupHeight);

      for (let index = 0; index < commandPopupHeight; index++) {
        const clearRow = conversationBoxTop - index - 1;
        if (clearRow >= 1) output.write(`\u001b[${clearRow};1H\u001b[2K`);
      }
      commandPopupHeight = 0;

      if (popupLines.length === 0) return;

      const theme = createTheme(noColor);
      const width = Math.min(62, Math.max(42, (output.columns || 100) - 24));
      const innerWidth = width - 2;
      const lines = [
        `╭${"─".repeat(innerWidth)}╮`,
        ...popupLines.map((line) => `│  ${line.slice(0, innerWidth - 4).padEnd(innerWidth - 4)}  │`),
        `╰${"─".repeat(innerWidth)}╯`,
      ];
      for (const [index, line] of lines.entries()) {
        output.write(`\u001b[${popupTop + index};1H\u001b[2K${theme.border(line)}`);
      }
      commandPopupHeight = lines.length;
      output.write(
        `\u001b[${conversationBoxTop + box.promptRowOffset};${box.promptCol + cursorPos}H\u001b[?25h`,
      );
    }

    function drawHomeCommandPopup(cursorRow: number, cursorCol: number) {
      const query = commandFilter || inputBuffer.toLowerCase();
      const matches = query.startsWith("/")
        ? fuzzyFilter(COMMANDS, query, ([command]) => command)
        : [];
      if (matches.length === 0) return;

      const theme = createTheme(noColor);
      const width = Math.min(62, Math.max(42, (output.columns || 100) - 24));
      const innerWidth = width - 2;
      const content = [
        "Commands",
        ...matches.map(([command, description], index) =>
          `${index === commandSelectionIndex ? "❯" : " "} ${command.padEnd(11)} ${description}`),
      ];
      const lines = [
        `╭${"─".repeat(innerWidth)}╮`,
        ...content.map((line) => `│  ${line.slice(0, innerWidth - 4).padEnd(innerWidth - 4)}  │`),
        `╰${"─".repeat(innerWidth)}╯`,
      ];
      const boxTop = cursorRow - 3;
      const popupTop = Math.max(1, boxTop - lines.length);
      for (const [index, line] of lines.entries()) {
        if (popupTop + index < 1) continue;
        output.write(`\u001b[${popupTop + index};1H\u001b[2K${theme.border(line)}`);
      }
      output.write(`\u001b[${cursorRow};${cursorCol}H\u001b[?25h`);
    }

    function submitConversationInput(task: string) {
      if (!conversationBoxVisible) return;
      for (let index = 0; index < 8; index++) {
        output.write(`\u001b[${conversationBoxTop + index};1H\u001b[2K`);
      }
      output.write(`\u001b[${conversationContentBottom};1H`);
      conversationBoxVisible = false;
    }

    function startThinkingSpinner(): () => void {
      const theme = createTheme(noColor);
      const frames = ["◐", "◓", "◑", "◒"];
      let frameIndex = 0;
      let stopped = false;
      const render = () => {
        if (stopped) return;
        const line = `  ${theme.accent(frames[frameIndex])} ${theme.muted("RIG is thinking...")}`;
        if (conversationLayoutActive) {
          output.write(`\u001b[${conversationContentBottom};1H\u001b[2K${line}`);
        } else {
          output.write(`\r\u001b[2K${line}`);
        }
        frameIndex = (frameIndex + 1) % frames.length;
      };

      if (conversationLayoutActive) {
        output.write(`\u001b[${conversationContentBottom};1H\u001b[2K`);
      } else {
        output.write("\n");
      }
      render();
      const timer = setInterval(render, 120);
      return () => {
        stopped = true;
        clearInterval(timer);
        if (conversationLayoutActive) {
          output.write(`\u001b[${conversationContentBottom};1H\u001b[2K`);
        } else {
          output.write("\r\u001b[2K");
        }
      };
    }

    function renderProviderMenu() {
      const theme = createTheme(noColor);
      const width = Math.min(86, Math.max(62, (output.columns || 100) - 16));
      const rows = Math.max(24, output.rows || 30);
      const lines = [
        "Select an AI provider",
        "",
        ...PROVIDERS.map((provider, index) => {
          const marker = index === providerIndex ? "❯" : " ";
          return `${marker} ${provider.label} - ${provider.description}`;
        }),
        "",
        "↑/↓ browse   ↵ choose   Esc cancel",
      ];
      drawProviderOverlay(lines, width, rows, theme);
    }

    function renderModelMenu() {
      const theme = createTheme(noColor);
      const width = Math.min(86, Math.max(62, (output.columns || 100) - 16));
      const rows = Math.max(24, output.rows || 30);
      const filteredModels = fuzzyFilter(modelOptions, modelSearch, (model) => `${model.id} ${model.label} ${model.description}`);
      const viewportSize = 8;
      const maxOffset = Math.max(0, filteredModels.length - viewportSize);
      modelScrollOffset = Math.min(modelScrollOffset, maxOffset);
      if (modelIndex >= filteredModels.length) modelIndex = Math.max(0, filteredModels.length - 1);
      if (modelIndex < modelScrollOffset) modelScrollOffset = modelIndex;
      if (modelIndex >= modelScrollOffset + viewportSize) {
        modelScrollOffset = modelIndex - viewportSize + 1;
      }
      const visibleModels = filteredModels.slice(modelScrollOffset, modelScrollOffset + viewportSize);
      const emptyHint = !modelLoading && filteredModels.length === 0
        ? (modelOptions.length === 0
          ? "No models — add a provider with /provider first"
          : "No matches — try a different search")
        : null;
      drawProviderOverlay(
        [
          modelLoading ? "Fetching models from provider..." : "Select an AI model",
          `Search: ${modelSearch}`,
          "",
          ...(modelLoading
            ? ["Please wait...", "", "", "", "", "", "", ""]
            : emptyHint
              ? [emptyHint, "", "", "", "", "", "", ""]
              : visibleModels.map((model, index) => {
                  const absoluteIndex = modelScrollOffset + index;
                  const marker = absoluteIndex === modelIndex ? "❯" : " ";
                  return `${marker} ${model.label}`;
                })),
          ...Array(Math.max(0, viewportSize - (emptyHint ? 1 : visibleModels.length))).fill(""),
          "",
          `${modelScrollOffset + 1}-${Math.min(modelScrollOffset + viewportSize, filteredModels.length)} of ${filteredModels.length}   ↑/↓ browse   Enter choose   Esc cancel`,
        ],
        width,
        rows,
        theme,
      );
      if (!modelLoading) {
        const overlayTop = providerOverlayTop;
        output.write(`\u001b[${overlayTop + 2};${12 + modelSearch.length}H\u001b[?25h`);
      }
    }

    function renderProviderCompatPrompt() {
      const theme = createTheme(noColor);
      const width = Math.min(86, Math.max(62, (output.columns || 100) - 16));
      const rows = Math.max(24, output.rows || 30);
      const compatOptions = [
        { id: "openai", label: "OpenAI-compatible", description: "OpenAI format (Bearer token, /v1/models)" },
        { id: "anthropic", label: "Anthropic", description: "Anthropic format (x-api-key, /v1/models)" },
      ];
      const lines = [
        `Third-party API type`,
        "",
        `Select compatibility for ${PROVIDERS[providerIndex].label}:`,
        "",
        ...compatOptions.map((opt, index) => {
          const marker = index === providerCompatIndex ? "❯" : " ";
          return `${marker} ${opt.label} — ${opt.description}`;
        }),
        "",
        "↑/↓ browse   ↵ choose   Esc cancel",
      ];
      drawProviderOverlay(lines, width, rows, theme);
    }

    function renderProviderBaseUrlPrompt() {
      const theme = createTheme(noColor);
      const width = Math.min(86, Math.max(62, (output.columns || 100) - 16));
      const rows = Math.max(24, output.rows || 30);
      const defaultHint = providerTempCompat === "anthropic" ? "https://api.anthropic.com" : "https://api.example.com/v1";
      const lines = [
        `Link ${PROVIDERS[providerIndex].label} (${providerTempCompat})`,
        "",
        "Enter the base URL for the API.",
        `Example: ${defaultHint}`,
        "",
        `URL = ${inputBuffer}`,
        "",
        "Enter save   Esc cancel",
      ];
      drawProviderOverlay(lines, width, rows, theme);
      const cursorLine = 5;
      const cursorCol = 1 + 3 + "URL = ".length + inputBuffer.length;
      output.write(`\u001b[${providerOverlayTop + 1 + cursorLine};${cursorCol}H\u001b[?25h`);
    }

    function renderProviderApiPrompt() {
      const theme = createTheme(noColor);
      const width = Math.min(86, Math.max(62, (output.columns || 100) - 16));
      const rows = Math.max(24, output.rows || 30);
      const lines = [
        `Link ${PROVIDERS[providerIndex].label}`,
        "",
        "Enter your API key. It will be saved locally in .rig/provider.json.",
        "",
        `API = ${"*".repeat(inputBuffer.length)}`,
        "",
        "Enter save   Esc cancel",
      ];
      drawProviderOverlay(lines, width, rows, theme);
    }

    function drawProviderOverlay(
      content: string[],
      width: number,
      rows: number,
      theme: ReturnType<typeof createTheme>,
    ) {
      if (conversationLayoutActive) output.write("\u001b[r");
      const innerWidth = width - 2;
      const top = Math.max(2, Math.floor((rows - content.length - 2) / 2));
      const lines = [
        `╭${"─".repeat(innerWidth)}╮`,
        ...content.map((line) => `│  ${line.slice(0, innerWidth - 4).padEnd(innerWidth - 4)}  │`),
        `╰${"─".repeat(innerWidth)}╯`,
      ];
      providerOverlayTop = top;
      providerOverlayHeight = lines.length;
      for (const [index, line] of lines.entries()) {
        output.write(`\u001b[${top + index};1H\u001b[2K${theme.borderBright(line)}`);
      }
      const cursorLine = content.findIndex((line) => line.startsWith("API = "));
      if (cursorLine >= 0) {
        const cursorCol = 1 + 3 + "API = ".length + inputBuffer.length;
        output.write(`\u001b[${top + 1 + cursorLine};${cursorCol}H\u001b[?25h`);
      }
    }

    async function beginProviderCommand() {
      providerMode = true;
      providerApiMode = false;
      providerCustomStage = null;
      providerTempBaseUrl = "";
      providerTempCompat = "openai";
      providerCompatIndex = 0;
      providerIndex = 0;
      inputBuffer = "";
      cursorPos = 0;
      renderProviderMenu();
      output.write("\u001b[?25h");
    }

    async function beginModelCommand() {
      modelMode = true;
      modelIndex = 0;
      modelSearch = "";
      modelScrollOffset = 0;
      modelLoading = true;
      renderModelMenu();
      try {
        const providerConfig = await loadProviderConfig(workspace);
        if (!providerConfig) {
          modelOptions = [];
          output.write(`\n  ${createTheme(noColor).warn(`No provider configured. Use /provider to add one.`)}\n`);
        } else {
          const discovered = await fetchAvailableModels(providerConfig);
          modelOptions = discovered;
          if (discovered.length === 0) {
            output.write(`\n  ${createTheme(noColor).warn(`Provider returned 0 models. Check base URL / API type.`)}\n`);
          }
        }
      } catch (error) {
        modelOptions = [];
        const message = error instanceof Error ? error.message : String(error);
        output.write(`\n  ${createTheme(noColor).warn(`${message} — realtime fetch failed, no hard-coded fallback.`)}\n`);
      } finally {
        modelLoading = false;
        modelIndex = 0;
        renderModelMenu();
      }
    }

    output.write("\u001b[r");
    console.clear();
    drawScreen(false);

    if (!noColor && output.isTTY) {
      const scheduleNextGlitch = () => {
        if (isExiting) return;
        const delay = 15000 + Math.floor(Math.random() * 5000);
        glitchInterval = setTimeout(() => {
          if (!inConversation && !inSetupMode && !isExiting && Date.now() - lastTypingTime > 1500) {
            drawScreen(true);
            glitchRestoreTimeout = setTimeout(() => {
              if (!inConversation && !inSetupMode && !isExiting) {
                drawScreen(false);
              }
              scheduleNextGlitch();
            }, 200);
          } else {
            scheduleNextGlitch();
          }
        }, delay);
      };
      scheduleNextGlitch();
    }

    const onResize = () => {
      if (isExiting) return;
      output.write("\u001b[r");
      if (inConversation) {
        output.write("\u001b[r");
        console.clear();
        inConversation = false;
        conversationBoxVisible = false;
        if (conversationLayoutActive) {
          // move terminal cursor to the active scrolling area before clear
          output.write(`\u001b[${conversationContentBottom};1H`);
          output.write("\u001b[r");
          conversationLayoutActive = false;
        }
        drawScreen(false);
        return;
      }
      if (providerMode || modelMode) {
        console.clear();
        if (providerMode && !providerApiMode) renderProviderMenu();
        else if (providerMode && providerApiMode) renderProviderApiPrompt();
        else if (modelMode) renderModelMenu();
        else drawScreen(false);
        return;
      }
      console.clear();
      drawScreen(false);
    };
    output.on("resize", onResize);

    const maybeInitializeMcu = async () => {
      if (await isMcuWorkspaceSetup(workspace)) return;

      let needRestoreRaw = false;
      try {
        if (input.isTTY && (input as any).isRaw) {
          try { (input as any).setRawMode(false); needRestoreRaw = true; } catch {}
        }
      } catch {}
      const rl = readline.createInterface({ input, output });
      try {
        const answer = await new Promise<string>((resolve) => {
          rl.question(`\n  ${createTheme(noColor).accent("Initialize MCU tooling for this workspace? [Y/n]: ")}`, (ans) => resolve(ans.trim()));
        });

        if (answer === "" || answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
          const profileAnswer = await new Promise<string>((resolve) => {
            rl.question(`  ${createTheme(noColor).accent("Profile [arduino/esp32-arduino/esp32-idf] (esp32-arduino): ")}`, (ans) => resolve((ans || "esp32-arduino").trim()));
          });
          const profile = (profileAnswer || "esp32-arduino") as "arduino" | "esp32-arduino" | "esp32-idf";
          const templateAnswer = await new Promise<string>((resolve) => {
            rl.question(`  ${createTheme(noColor).accent("Template [minimal/wifi/ble/webserver/custom] (minimal): ")}`, (ans) => resolve((ans || "minimal").trim()));
          });

          const template = (templateAnswer || "minimal") as "minimal" | "wifi" | "ble" | "webserver" | "custom";
          await initializeMcuWorkspace(workspace, { profile, template });
          console.log(`\n  ${createTheme(noColor).success("MCU scaffold created for ")}${createTheme(noColor).brand(profile)}`);
        }
      } finally {
        rl.close();
        if (needRestoreRaw) try { (input as any).setRawMode(true); } catch {}
      }
    };

    readline.emitKeypressEvents(input);
    input.setRawMode(true);

    const cleanup = () => {
      isExiting = true;
      if (conversationLayoutActive) {
        output.write(`\u001b[${conversationContentBottom};1H`);
        output.write("\u001b[r");
        conversationLayoutActive = false;
      }
      if (glitchInterval) clearTimeout(glitchInterval);
      if (glitchRestoreTimeout) clearTimeout(glitchRestoreTimeout);
      output.removeListener("resize", onResize);
      input.removeListener("keypress", handleInput);
      if (input.isTTY) {
        input.setRawMode(false);
      }
      output.write("\u001b[?25h\n");
      resolve();
    };

    function cycleCommandSelection(direction: 1 | -1): boolean {
      const query = commandFilter || inputBuffer.toLowerCase();
      if (!query.startsWith("/")) return false;
      const matches = fuzzyFilter(COMMANDS, query, ([command]) => command);
      if (matches.length === 0) return false;

      commandSelectionIndex =
        (commandSelectionIndex + direction + matches.length) % matches.length;
      inputBuffer = matches[commandSelectionIndex][0];
      cursorPos = inputBuffer.length;
      if (inConversation) drawConversationInput();
      else drawScreen(false);
      return true;
    }

    const handleInput = async (str: string, key: readline.Key) => {
      if (isExiting) return;

      if (key.ctrl && (key.name === "c" || key.name === "d")) {
        cleanup();
        console.log(renderGoodbye(noColor));
        process.exit(0);
      }

      lastTypingTime = Date.now();

      if (modelMode) {
        if (key.name === "escape") {
          modelMode = false;
          modelIndex = 0;
          output.write("\u001b[r");
      console.clear();
          drawScreen(false);
          return;
        }
        if (key.name === "up") {
          if (modelLoading) return;
          const count = fuzzyFilter(modelOptions, modelSearch, (model) => `${model.id} ${model.label} ${model.description}`).length;
          if (count === 0) return;
          modelIndex = (modelIndex + count - 1) % count;
          renderModelMenu();
          return;
        }
        if (key.name === "down") {
          if (modelLoading) return;
          const count = fuzzyFilter(modelOptions, modelSearch, (model) => `${model.id} ${model.label} ${model.description}`).length;
          if (count === 0) return;
          modelIndex = (modelIndex + 1) % count;
          renderModelMenu();
          return;
        }
        if (key.name === "return" || key.name === "enter") {
          if (modelLoading || modelOptions.length === 0) return;
          const filteredModels = fuzzyFilter(modelOptions, modelSearch, (model) => `${model.id} ${model.label} ${model.description}`);
          if (filteredModels.length === 0) return;
          const selected = filteredModels[modelIndex];
          await saveModelConfig(workspace, selected.id);
          await refreshCurrentModel();
          modelMode = false;
          modelIndex = 0;
          output.write("\u001b[r");
      console.clear();
          console.log(`\n  Model selected: ${selected.label}\n`);
          inConversation = false;
          conversationBoxVisible = false;
          if (conversationLayoutActive) {
            output.write(`\u001b[${conversationContentBottom};1H`);
            output.write("\u001b[r");
            conversationLayoutActive = false;
          }
          drawScreen(false);
          return;
        }
        if (key.name === "backspace") {
          if (modelSearch.length > 0) {
            modelSearch = modelSearch.slice(0, -1);
            modelIndex = 0;
            modelScrollOffset = 0;
            renderModelMenu();
          }
          return;
        }
        if (str && !key.ctrl && !key.meta && str && str.length >= 1) {
          modelSearch += str;
          modelIndex = 0;
          modelScrollOffset = 0;
          renderModelMenu();
        }
        return;
      }

      if (providerMode) {
        if (key.name === "escape") {
          providerMode = false;
          providerApiMode = false;
          providerCustomStage = null;
          providerTempBaseUrl = "";
          providerTempCompat = "openai";
          providerCompatIndex = 0;
          inputBuffer = "";
          cursorPos = 0;
          providerOverlayTop = 0;
          providerOverlayHeight = 0;
          output.write("\u001b[r");
      console.clear();
          drawScreen(false);
          return;
        }

        if (!providerApiMode) {
          if (key.name === "up") {
            providerIndex = (providerIndex + PROVIDERS.length - 1) % PROVIDERS.length;
            renderProviderMenu();
          } else if (key.name === "down") {
            providerIndex = (providerIndex + 1) % PROVIDERS.length;
            renderProviderMenu();
          } else if (key.name === "return" || key.name === "enter") {
            const selected = PROVIDERS[providerIndex];
            if (selected.id === "custom") {
              providerCustomStage = "compat";
              providerCompatIndex = 0;
              providerTempCompat = "openai";
              providerTempBaseUrl = "";
              providerApiMode = true;
              inputBuffer = "";
              cursorPos = 0;
              renderProviderCompatPrompt();
            } else {
              providerCustomStage = null;
              providerApiMode = true;
              inputBuffer = "";
              cursorPos = 0;
              renderProviderApiPrompt();
            }
          }
          return;
        }

        if (providerCustomStage === "compat") {
          if (key.name === "up") {
            providerCompatIndex = (providerCompatIndex + 2 - 1) % 2;
            renderProviderCompatPrompt();
          } else if (key.name === "down") {
            providerCompatIndex = (providerCompatIndex + 1) % 2;
            renderProviderCompatPrompt();
          } else if (key.name === "return" || key.name === "enter") {
            providerTempCompat = providerCompatIndex === 0 ? "openai" : "anthropic";
            providerCustomStage = "baseUrl";
            inputBuffer = "";
            cursorPos = 0;
            renderProviderBaseUrlPrompt();
          }
          return;
        }

        if (providerCustomStage === "baseUrl") {
          if (key.name === "return" || key.name === "enter") {
            providerTempBaseUrl = inputBuffer.trim();
            providerCustomStage = "apiKey";
            inputBuffer = "";
            cursorPos = 0;
            renderProviderApiPrompt();
            return;
          }
          if (key.name === "backspace") {
            if (cursorPos > 0) {
              inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
              cursorPos--;
              renderProviderBaseUrlPrompt();
            }
            return;
          }
          if (str && !key.ctrl && !key.meta && str && str.length >= 1) {
            inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
            cursorPos += str.length;
            renderProviderBaseUrlPrompt();
          }
          return;
        }

        if (key.name === "return" || key.name === "enter") {
          const selected = PROVIDERS[providerIndex];
          const isCustom = selected.id === "custom";
          const finalBaseUrl = isCustom ? (providerTempBaseUrl || undefined) : selected.baseUrl;
          const finalCompat = isCustom ? providerTempCompat : (selected as any).apiCompat;
          await saveProviderConfig(workspace, {
            provider: selected.id,
            apiKey: inputBuffer,
            ...(finalBaseUrl ? { baseUrl: finalBaseUrl } : {}),
            ...(finalCompat ? { apiCompat: finalCompat as any } : {}),
            updatedAt: new Date().toISOString(),
          });
          try {
            const cfg = await loadProviderConfig(workspace);
            if (cfg) {
              const models = await fetchAvailableModels(cfg);
              output.write(`\n  ${createTheme(noColor).success(`Fetched ${models.length} models from provider.`)} \n`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            output.write(`\n  ${createTheme(noColor).warn(`Provider linked, but model discovery failed: ${msg}`)} \n`);
          }
          providerMode = false;
          providerApiMode = false;
          providerCustomStage = null;
          inputBuffer = "";
          cursorPos = 0;
          output.write("\u001b[r");
      console.clear();
          console.log(`\n  Provider linked: ${selected.label}${isCustom ? ` (${finalCompat})` : ""}\n`);
          await refreshCurrentModel();
          inConversation = false;
          conversationBoxVisible = false;
          if (conversationLayoutActive) {
            output.write(`\u001b[${conversationContentBottom};1H`);
            output.write("\u001b[r");
            conversationLayoutActive = false;
          }
          drawScreen(false);
          return;
        }

        if (key.name === "backspace") {
          if (cursorPos > 0) {
            inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
            cursorPos--;
            renderProviderApiPrompt();
          }
          return;
        }

        if (str && !key.ctrl && !key.meta && str && str.length >= 1) {
          inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
          cursorPos += str.length;
          renderProviderApiPrompt();
        }
        return;
      }

      // ── Setup Mode Handler ──
      if (inSetupMode) {
        if (key.name === "return" || key.name === "enter") {
          const choice = inputBuffer.trim().toLowerCase();
          inputBuffer = "";
          cursorPos = 0;

          if (choice === "" || choice === "y" || choice === "yes") {
            await setupWorkspace(workspace);
            await maybeInitializeMcu();
          }

          inSetupMode = false;
          output.write("\u001b[r");
      console.clear();
          drawScreen(false);
          return;
        }

        if (key.name === "backspace") {
          if (cursorPos > 0) {
            inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
            cursorPos--;
            drawScreen(false);
          }
          return;
        }

        if (str && !key.ctrl && !key.meta && str && str.length >= 1) {
          inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
          cursorPos += str.length;
          drawScreen(false);
        }
        return;
      }

      // ── Normal Mode Handler ──
      if (key.name === "return" || key.name === "enter") {
        const task = inputBuffer.trim();
        inputBuffer = "";
        cursorPos = 0;

        if (!task) {
          if (!inConversation) drawScreen(false);
          return;
        }

        if (task === "/quit" || task === "/exit") {
          cleanup();
          console.log(renderGoodbye(noColor));
          process.exit(0);
        }

        if (task === "/clear") {
          inConversation = false;
          commandFilter = "";
          commandSelectionIndex = 0;
          conversationBoxVisible = false;
          if (conversationLayoutActive) {
            output.write(`\u001b[${conversationContentBottom};1H`);
            output.write("\u001b[r");
            conversationLayoutActive = false;
          }
          output.write("\u001b[r");
          console.clear();
          drawScreen(false);
          return;
        }

        if (task === "/provider") {
          inputBuffer = "";
          cursorPos = 0;
          commandFilter = "";
          commandSelectionIndex = 0;
          await beginProviderCommand();
          return;
        }

        if (task === "/model") {
          inputBuffer = "";
          cursorPos = 0;
          commandFilter = "";
          commandSelectionIndex = 0;
          await beginModelCommand();
          return;
        }

        if (task === "/status") {
          await printStatus();
          return;
        }

        if (task === "/help") {
          inConversation = true;
          output.write("\u001b[r");
      console.clear();
          console.log(renderHelp(noColor));
          console.log(renderUserMessage("/help", { noColor }));
          console.log("");
          return;
        }

        // Execute Agent Turn
        const continuingConversation = inConversation;
        inConversation = true;
        if (continuingConversation) {
          submitConversationInput(task);
        } else {
          output.write("\u001b[r");
      console.clear();
          conversationLayoutActive = false;
          conversationBoxVisible = false;
          drawConversationInput();
          submitConversationInput(task);
        }
        console.log(renderUserMessage(task, { noColor }));

        const stopThinkingSpinner = startThinkingSpinner();
        try {
          input.setRawMode(false);
          const result = await runTask(task, { workspace, noColor });
          stopThinkingSpinner();
          console.log(renderTurn(result, { noColor }).join("\n"));
          console.log(
            `  \u001b[38;5;242msession\u001b[0m \u001b[38;5;242m${result.sessionId}\u001b[0m\n`,
          );
        } catch (error) {
          stopThinkingSpinner();
          console.log(renderError(error, noColor));
        } finally {
          if (!isExiting && input.isTTY) {
            input.setRawMode(true);
          }
        }

        console.log(`  \u001b[38;5;242mType /clear to return to the welcome screen.\u001b[0m\n`);
        drawConversationInput();
        return;
      }

      if (key.name === "backspace") {
        if (cursorPos > 0) {
          inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
          cursorPos--;
          commandFilter = inputBuffer.startsWith("/") ? inputBuffer.toLowerCase() : "";
          commandSelectionIndex = 0;
          if (inConversation) drawConversationInput();
          else drawScreen(false);
        }
        return;
      }

      if (key.name === "delete") {
        if (cursorPos < inputBuffer.length) {
          inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
          if (inConversation) drawConversationInput();
          else drawScreen(false);
        }
        return;
      }

      if (key.name === "up") {
        if (cycleCommandSelection(-1)) return;
      }

      if (key.name === "down") {
        if (cycleCommandSelection(1)) return;
      }

      if (key.name === "tab") {
        if (cycleCommandSelection(key.shift ? -1 : 1)) return;
      }

      if (key.name === "left") {
        if (cursorPos > 0) {
          cursorPos--;
          if (inConversation) drawConversationInput();
          else drawScreen(false);
        }
        return;
      }

      if (key.name === "right") {
        if (cursorPos < inputBuffer.length) {
          cursorPos++;
          if (inConversation) drawConversationInput();
          else drawScreen(false);
        }
        return;
      }

      if ((key.ctrl && key.name === "a") || key.name === "home") {
        cursorPos = 0;
        if (inConversation) drawConversationInput();
        else drawScreen(false);
        return;
      }

      if ((key.ctrl && key.name === "e") || key.name === "end") {
        cursorPos = inputBuffer.length;
        if (inConversation) drawConversationInput();
        else drawScreen(false);
        return;
      }

      if (str && !key.ctrl && !key.meta && str && str.length >= 1) {
        inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
        cursorPos += str.length;
        commandFilter = inputBuffer.startsWith("/") ? inputBuffer.toLowerCase() : "";
        commandSelectionIndex = 0;
        if (inConversation) drawConversationInput();
        else drawScreen(false);
      }
    };

    input.on("keypress", handleInput);
  });
}

export const program = new Command();
program
  .name("rig")
  .description("A terminal-native AI harness for autonomous agents.")
  .version(VERSION)
  .option("--no-color", "disable terminal styling")
  .option("--json", "print machine-readable output")
  .option("-y, --yes", "auto-approve all write and verify actions")
  .option("-m, --model <model>", "model to use for execution")
  .option("--max-steps <number>", "maximum agent loop steps", "30");

program.action(async () => {
  const options = program.opts();
  await runInteractive(process.cwd(), options.color === false);
});

program
  .command("ask")
  .argument("<question>")
  .description("Ask a question about the workspace")
  .option("--cwd <path>", "workspace to inspect", process.cwd())
  .action(async (question, options, command) => {
    try {
      const global = command.parent?.opts() ?? {};
      const result = await runTask(question, {
        workspace: path.resolve(options.cwd),
        model: global.model,
        maxSteps: global.maxSteps ? parseInt(global.maxSteps, 10) : undefined,
        autoApprove: global.yes,
        noColor: global.color === false,
      });
      console.log(renderAsk(result, { noColor: global.color === false, json: global.json }));
    } catch (error) {
      console.error(renderError(error, command.parent?.opts().color === false));
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .argument("<task>")
  .description("Run an autonomous coding task in the workspace")
  .option("--cwd <path>", "workspace to modify", process.cwd())
  .action(async (task, options, command) => {
    try {
      const global = command.parent?.opts() ?? {};
      const result = await runTask(task, {
        workspace: path.resolve(options.cwd),
        model: global.model,
        maxSteps: global.maxSteps ? parseInt(global.maxSteps, 10) : undefined,
        autoApprove: global.yes,
        noColor: global.color === false,
      });
      console.log(renderAsk(result, { noColor: global.color === false, json: global.json }));
    } catch (error) {
      console.error(renderError(error, command.parent?.opts().color === false));
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Show workspace and provider/model status")
  .option("--cwd <path>", "workspace to inspect", process.cwd())
  .action(async (options, command) => {
    try {
      const global = command.parent?.opts() ?? {};
      const noColor = global.color === false;
      const ws = path.resolve(options.cwd);
      const provider = await loadProviderConfig(ws);
      const model = (await loadModelConfig(ws)) || provider?.model || process.env["RIG_MODEL"];
      if (global.json) {
        const safeProvider = provider ? { provider: provider.provider, baseUrl: provider.baseUrl ?? null, apiCompat: (provider as any).apiCompat ?? null, hasKey: Boolean(provider.apiKey) } : null;
        console.log(JSON.stringify({ workspace: ws, provider: safeProvider, model: model ?? null }, null, 2));
      } else {
        console.log(renderStatus(ws, provider as any, model ?? undefined, noColor));
      }
    } catch (error) {
      console.error(renderError(error, false));
      process.exitCode = 1;
    }
  });

program
  .command("config")
  .description("Show the resolved RIG configuration for this workspace")
  .option("--cwd <path>", "workspace to inspect", process.cwd())
  .action(async (options, command) => {
    const global = command.parent?.opts() ?? {};
    const noColor = global.color === false;
    try {
      const report = await collectConfig(path.resolve(options.cwd));
      console.log(global.json ? JSON.stringify(report, null, 2) : renderConfig(report, noColor));
    } catch (error) {
      console.error(renderError(error, noColor));
      process.exitCode = 1;
    }
  });

program
  .command("log")
  .description("List saved sessions, or inspect one session's event log")
  .argument("[sessionId]", "session to inspect, or 'last' for the most recent")
  .option("--cwd <path>", "workspace to inspect", process.cwd())
  .action(async (sessionId, options, command) => {
    const global = command.parent?.opts() ?? {};
    const noColor = global.color === false;
    try {
      const ws = path.resolve(options.cwd);

      if (!sessionId) {
        const sessions = await collectSessions(ws);
        console.log(global.json ? JSON.stringify(sessions, null, 2) : renderSessionList(sessions, noColor));
        return;
      }

      const resolved = sessionId === "last" ? (await collectSessions(ws))[0]?.id : sessionId;
      if (!resolved) {
        console.error(renderError(new Error("No saved sessions found in this workspace."), noColor));
        process.exitCode = 1;
        return;
      }

      const detail = await collectSessionDetail(ws, resolved);
      if (!detail) {
        console.error(renderError(new Error(`Session '${resolved}' was not found in ${ws}.`), noColor));
        process.exitCode = 1;
        return;
      }

      console.log(global.json ? JSON.stringify(detail, null, 2) : renderSessionDetail(detail, noColor));
    } catch (error) {
      console.error(renderError(error, noColor));
      process.exitCode = 1;
    }
  });

program
  .command("resume")
  .description("Resume the most recent unfinished session")
  .argument("[sessionId]", "session to resume (defaults to the most recent unfinished one)")
  .option("--cwd <path>", "workspace to continue in", process.cwd())
  .option("--summary", "only show what the session did, without continuing it")
  .action(async (sessionId, options, command) => {
    const global = command.parent?.opts() ?? {};
    const noColor = global.color === false;
    try {
      const ws = path.resolve(options.cwd);
      const session = await findResumableSession(ws, sessionId);
      if (!session) {
        console.error(renderError(new Error("No saved session to resume in this workspace."), noColor));
        process.exitCode = 1;
        return;
      }

      const detail = await collectSessionDetail(ws, session.id);
      if (detail) console.log(renderSessionDetail(detail, noColor));
      if (options.summary) return;

      console.log(`  ${createTheme(noColor).muted("Continuing session...")}\n`);
      const result = await runTask(session.task, {
        workspace: ws,
        model: global.model,
        maxSteps: global.maxSteps ? parseInt(global.maxSteps, 10) : undefined,
        autoApprove: global.yes,
        noColor,
        resumeSessionId: session.id,
      });
      console.log(renderAsk(result, { noColor, json: global.json }));
    } catch (error) {
      console.error(renderError(error, noColor));
      process.exitCode = 1;
    }
  });

program
  .command("review")
  .description("Review the current workspace changes")
  .option("--cwd <path>", "workspace to review", process.cwd())
  .option("--staged", "review staged changes instead of unstaged ones")
  .option("--file <path>", "review a single file")
  .action(async (options, command) => {
    const global = command.parent?.opts() ?? {};
    const noColor = global.color === false;
    try {
      const ws = path.resolve(options.cwd);
      const review = await collectReviewDiff(ws, { staged: options.staged, file: options.file });

      if (!review.diff) {
        console.log(
          global.json
            ? JSON.stringify({ ...review, message: "No changes to review." }, null, 2)
            : `\n  ${createTheme(noColor).warn("No changes to review.")}\n`,
        );
        return;
      }

      if (!global.json) console.log(renderReviewHeader(review, noColor));

      const result = await runTask(buildReviewTask(review), {
        workspace: ws,
        model: global.model,
        maxSteps: global.maxSteps ? parseInt(global.maxSteps, 10) : undefined,
        autoApprove: global.yes,
        noColor,
      });
      console.log(renderAsk(result, { noColor, json: global.json }));
    } catch (error) {
      console.error(renderError(error, noColor));
      process.exitCode = 1;
    }
  });

// Unconditionally parse CLI arguments when executed
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
