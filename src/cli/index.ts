#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { initializeMcuWorkspace, isMcuWorkspaceSetup } from "../config/mcu-setup.js";
import {
  MODELS,
  PROVIDERS,
  fetchAvailableModels,
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
  renderTurn,
  renderUserMessage,
  renderWelcomeScreen,
} from "./render.js";

const COMMANDS: Array<[string, string]> = [
  ["/provider", "Link an AI provider"],
  ["/model", "Choose an AI model"],
  ["/help", "Show available commands"],
  ["/clear", "Reset the conversation"],
  ["/exit", "Exit RIG"],
  ["/quit", "Exit RIG"],
];

async function requestTerminalApproval(req: ApprovalRequest, noColor = false): Promise<boolean> {
  const theme = createTheme(noColor);
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
}

export async function runTask(
  task: string,
  options: {
    workspace?: string;
    model?: string;
    maxSteps?: number;
    autoApprove?: boolean;
    noColor?: boolean;
  } = {},
): Promise<AgentResult> {
  const workspace = path.resolve(options.workspace || process.cwd());

  return runAgentLoop({
    task,
    workspace,
    model: options.model,
    maxSteps: options.maxSteps,
    autoApprove: options.autoApprove,
    onApprovalRequest: async (req) => requestTerminalApproval(req, options.noColor),
  });
}

export function runInteractive(workspace = process.cwd(), noColor = false): Promise<void> {
  return new Promise<void>(async (resolve) => {
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
    let providerIndex = 0;
    let providerOverlayTop = 0;
    let providerOverlayHeight = 0;
    let modelMode = false;
    let modelIndex = 0;
    let modelOptions: AvailableModel[] = [...MODELS];
    let modelLoading = false;
    let modelSearch = "";
    let modelScrollOffset = 0;
    let commandFilter = "";
    let commandSelectionIndex = 0;

    function drawScreen(isGlitch = false) {
      if (inConversation || isExiting) return;

      if (inSetupMode) {
        const { screenContent, cursorRow, cursorCol } = renderSetupScreen(
          workspace,
          inputBuffer,
          cursorPos,
          { noColor },
        );
        output.write(`\u001b[H${screenContent}`);
        output.write(`\u001b[${cursorRow};${cursorCol}H\u001b[?25h`);
        return;
      }

      const { screenContent, cursorRow, cursorCol } = renderWelcomeScreen(
        workspace,
        inputBuffer,
        cursorPos,
        isGlitch,
        { noColor },
      );
      output.write(`\u001b[H${screenContent}`);
      output.write(`\u001b[${cursorRow};${cursorCol}H\u001b[?25h`);
      drawHomeCommandPopup(cursorRow, cursorCol);
    }

    function drawConversationInput() {
      if (!inConversation || isExiting) return;
      const box = renderInputBox(
        inputBuffer,
        cursorPos,
        output.columns || 100,
        noColor,
        Math.floor((output.columns || 100) * 0.9),
      );
      const firstRender = !conversationBoxVisible;

      if (!conversationLayoutActive) {
        const rows = Math.max(24, output.rows || 30);
        conversationContentBottom = Math.max(1, rows - 7);
        conversationBoxTop = conversationContentBottom + 1;
        output.write(`\u001b[1;${conversationContentBottom}r`);
        conversationLayoutActive = true;
      }

      if (firstRender) {
        for (const [index, line] of box.lines.entries()) {
          output.write(`\u001b[${conversationBoxTop + index};1H\u001b[2K${line}`);
        }
        conversationBoxVisible = true;
      } else {
        output.write(
          `\u001b[${conversationBoxTop + box.promptRowOffset};1H\u001b[2K${box.lines[box.promptRowOffset]}`,
        );
      }
      output.write(
        `\u001b[${conversationBoxTop + box.promptRowOffset};${box.promptCol + cursorPos}H\u001b[?25h`,
      );
      drawCommandPopup(box);
    }

    function drawCommandPopup(box: ReturnType<typeof renderInputBox>) {
      const query = commandFilter || inputBuffer.toLowerCase();
      const matches = query.startsWith("/")
        ? COMMANDS.filter(([command]) => command.startsWith(query))
        : [];
      const popupLines = matches.length > 0
        ? [
            "Commands",
            ...matches.map(([command, description], index) =>
              `${index === commandSelectionIndex ? "❯" : " "} ${command.padEnd(11)} ${description}`),
          ]
        : [];
      const popupHeight = popupLines.length + 2;
      const popupTop = conversationBoxTop - popupHeight;

      for (let index = 0; index < commandPopupHeight; index++) {
        output.write(`\u001b[${conversationBoxTop - index - 1};1H\u001b[2K`);
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
        ? COMMANDS.filter(([command]) => command.startsWith(query))
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
      const popupTop = boxTop - lines.length;
      for (const [index, line] of lines.entries()) {
        output.write(`\u001b[${popupTop + index};1H\u001b[2K${theme.border(line)}`);
      }
      output.write(`\u001b[${cursorRow};${cursorCol}H\u001b[?25h`);
    }

    function submitConversationInput(task: string) {
      if (!conversationBoxVisible) return;
      for (let index = 0; index < 7; index++) {
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
        if (!stopped) {
          output.write(
            `\r\u001b[2K  ${theme.accent(frames[frameIndex])} ${theme.muted("RIG is thinking...")}`,
          );
          frameIndex = (frameIndex + 1) % frames.length;
        }
      };

      output.write("\n");
      render();
      const timer = setInterval(render, 120);
      return () => {
        stopped = true;
        clearInterval(timer);
        output.write("\r\u001b[2K");
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
      const filteredModels = modelOptions.filter((model) =>
        model.id.toLowerCase().includes(modelSearch.toLowerCase()),
      );
      const viewportSize = 8;
      const maxOffset = Math.max(0, filteredModels.length - viewportSize);
      modelScrollOffset = Math.min(modelScrollOffset, maxOffset);
      if (modelIndex >= filteredModels.length) modelIndex = Math.max(0, filteredModels.length - 1);
      if (modelIndex < modelScrollOffset) modelScrollOffset = modelIndex;
      if (modelIndex >= modelScrollOffset + viewportSize) {
        modelScrollOffset = modelIndex - viewportSize + 1;
      }
      const visibleModels = filteredModels.slice(modelScrollOffset, modelScrollOffset + viewportSize);
      drawProviderOverlay(
        [
          modelLoading ? "Fetching models from provider..." : "Select an AI model",
          `Search: ${modelSearch}`,
          "",
          ...(modelLoading
            ? ["Please wait...", "", "", "", "", "", "", ""]
            : visibleModels.map((model, index) => {
                const absoluteIndex = modelScrollOffset + index;
                const marker = absoluteIndex === modelIndex ? "❯" : " ";
                return `${marker} ${model.label}`;
              })),
          ...Array(Math.max(0, viewportSize - visibleModels.length)).fill(""),
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
          modelOptions = [...MODELS];
        } else {
          const discovered = await fetchAvailableModels(providerConfig);
          modelOptions = discovered.length > 0 ? discovered : [...MODELS];
        }
      } catch (error) {
        modelOptions = [...MODELS];
        const message = error instanceof Error ? error.message : String(error);
        output.write(`\n  ${createTheme(noColor).warn(`${message} Using fallback presets.`)}\n`);
      } finally {
        modelLoading = false;
        modelIndex = 0;
        renderModelMenu();
      }
    }

    console.clear();
    drawScreen(false);

    if (!noColor && output.isTTY) {
      const scheduleNextGlitch = () => {
        if (isExiting) return;
        const delay = 3500 + Math.floor(Math.random() * 2000);
        glitchInterval = setTimeout(() => {
          if (!inConversation && !inSetupMode && !isExiting && Date.now() - lastTypingTime > 1500) {
            drawScreen(true);
            glitchRestoreTimeout = setTimeout(() => {
              if (!inConversation && !inSetupMode && !isExiting) {
                drawScreen(false);
              }
              scheduleNextGlitch();
            }, 110);
          } else {
            scheduleNextGlitch();
          }
        }, delay);
      };
      scheduleNextGlitch();
    }

    const onResize = () => {
      if (!inConversation && !isExiting) {
        console.clear();
        drawScreen(false);
      }
    };
    output.on("resize", onResize);

    const maybeInitializeMcu = async () => {
      if (await isMcuWorkspaceSetup(workspace)) return;

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
      }
    };

    if (!input.isTTY) {
      const rl = readline.createInterface({ input, output });
      try {
        for await (const line of rl) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "/quit" || trimmed === "/exit") break;
          const result = await runTask(trimmed, { workspace, noColor });
          console.log(renderAsk(result, { noColor }));
        }
      } finally {
        rl.close();
        resolve();
      }
      return;
    }

    readline.emitKeypressEvents(input);
    input.setRawMode(true);

    const cleanup = () => {
      isExiting = true;
      if (conversationLayoutActive) {
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
      const matches = COMMANDS.filter(([command]) => command.startsWith(query));
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
          console.clear();
          drawScreen(false);
          return;
        }
        if (key.name === "up") {
          if (modelLoading) return;
          const count = modelOptions.filter((model) =>
            model.id.toLowerCase().includes(modelSearch.toLowerCase()),
          ).length;
          if (count === 0) return;
          modelIndex = (modelIndex + count - 1) % count;
          renderModelMenu();
          return;
        }
        if (key.name === "down") {
          if (modelLoading) return;
          const count = modelOptions.filter((model) =>
            model.id.toLowerCase().includes(modelSearch.toLowerCase()),
          ).length;
          if (count === 0) return;
          modelIndex = (modelIndex + 1) % count;
          renderModelMenu();
          return;
        }
        if (key.name === "return" || key.name === "enter") {
          if (modelLoading || modelOptions.length === 0) return;
          const filteredModels = modelOptions.filter((model) =>
            model.id.toLowerCase().includes(modelSearch.toLowerCase()),
          );
          if (filteredModels.length === 0) return;
          const selected = filteredModels[modelIndex];
          await saveModelConfig(workspace, selected.id);
          modelMode = false;
          modelIndex = 0;
          console.clear();
          console.log(`\n  Model selected: ${selected.label}\n`);
          inConversation = false;
          conversationBoxVisible = false;
          if (conversationLayoutActive) {
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
        if (str && !key.ctrl && !key.meta && str.length === 1) {
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
          inputBuffer = "";
          cursorPos = 0;
          providerOverlayTop = 0;
          providerOverlayHeight = 0;
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
            providerApiMode = true;
            inputBuffer = "";
            cursorPos = 0;
            renderProviderApiPrompt();
          }
          return;
        }

        if (key.name === "return" || key.name === "enter") {
          const selected = PROVIDERS[providerIndex];
          await saveProviderConfig(workspace, {
            provider: selected.id,
            apiKey: inputBuffer,
            ...(selected.baseUrl ? { baseUrl: selected.baseUrl } : {}),
            updatedAt: new Date().toISOString(),
          });
          providerMode = false;
          providerApiMode = false;
          inputBuffer = "";
          cursorPos = 0;
          console.clear();
          console.log(`\n  Provider linked: ${selected.label}\n`);
          inConversation = false;
          conversationBoxVisible = false;
          if (conversationLayoutActive) {
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

        if (str && !key.ctrl && !key.meta && str.length === 1) {
          inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
          cursorPos++;
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

        if (str && !key.ctrl && !key.meta && str.length === 1) {
          inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
          cursorPos++;
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
            output.write("\u001b[r");
            conversationLayoutActive = false;
          }
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

        if (task === "/help") {
          inConversation = true;
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

      if (str && !key.ctrl && !key.meta && str.length === 1) {
        inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
        cursorPos++;
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
  .version("0.1.0")
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

for (const [name, description] of [
  ["review", "Review the current workspace changes"],
  ["resume", "Resume a saved session"],
  ["status", "Show workspace and session status"],
  ["log", "Inspect a saved session log"],
  ["config", "View RIG configuration"],
] as const) {
  program.command(name).description(description);
}

// Unconditionally parse CLI arguments when executed
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
