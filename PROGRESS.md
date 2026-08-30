# RIG — Development Progress & Architecture Report

> **Project**: RIG (Terminal-Native AI Harness for Autonomous Agents)  
> **Repository**: `/Users/ayushnimbhare/Files/Projects/rig`  
> **Status**: Core runtime, interactive conversation UX, provider linking, and MCU scaffolding complete • Review/resume command implementations remain roadmap work  
> **Last Updated**: August 30, 2026  

---

## 1. Project Overview

RIG is an engineering harness for autonomous AI agents that operate directly inside real codebases from the command line. Unlike standard web-chat wrappers, RIG provides a structured execution loop where the model inspects repositories, plans work, proposes structured patches, executes verification commands, and reports outcomes within strict safety boundaries.

---

## 2. Completed Architecture & Milestones

```mermaid
graph TD
    CLI["Terminal TUI / CLI<br/>src/cli/index.ts"] --> Onboarding["Workspace Onboarding<br/>src/config/workspace-setup.ts"]
    CLI --> Runtime["Agent Execution Loop<br/>src/core/agent-loop.ts"]
    Runtime --> Context["Context Engine<br/>src/context/context-engine.ts"]
    Runtime --> ModelClient["Model Client Layer<br/>OpenAIClient / MockModelClient"]
    Runtime --> Safety["Safety & Policy Engine<br/>src/safety/policy.ts"]
    Runtime --> Tools["Tool Registry & Tools<br/>src/tools/"]
    Runtime --> Sessions["Session Manager (JSONL)<br/>src/core/session.ts"]

    Tools --> T1["Read Tools (list_files, read_file, search_text)"]
    Tools --> T2["Git Tools (git_status, git_diff)"]
    Tools --> T3["Patch Tool (write_patch)"]
    Tools --> T4["Shell Runner (run_shell)"]
```

---

## 3. Detailed Component Breakdown

### A. Terminal User Interface (TUI) & Frontend
- **Design Aesthetic**: Pixel-perfect cyberpunk / neon purple interface inspired by OpenCode & Claude Code.
- **Top Bar**: macOS-style traffic light pills (`● ● ●`), active version (`rig v0.1.0`), dynamic shortened workspace path (`~/...`), and command shortcuts (`[ ⌘K to toggle ]`).
- **Ambient Scanlines & Glitch Pulse**: Seeded matrix-style scanlines on left/right margins. Glitch pulses flicker every 3.5–5s without moving the cursor or erasing background elements.
- **Interactive Boxed Input**: Rounded border container (`╭───╮`, `╰───╯`) with placeholder header, `›` input row with character cursor locking, navigation shortcuts (`↑↓ to navigate ↵ to send [→]`), and command footer.
- **Raw-Mode Keystroke Engine**: Full arrow key navigation (Left/Right), Backspace, Delete, Home (`Ctrl+A`), End (`Ctrl+E`), Enter, and instant `/clear`, `/help`, `/quit` commands.
- **Conversation View**: User and assistant turns remain in terminal scrollback; a single bottom-anchored boxed input stays available for the next prompt.
- **Thinking Indicator**: Themed animated spinner appears while the model and tools are working.
- **Provider Popup**: `/provider` opens a themed provider-selection popup with OpenAI, OpenRouter, Ollama, and custom endpoint options.

### B. Zero-Friction Workspace Onboarding
- **First-Run Detection**: When launched in any folder for the first time, detects if `.rig/` exists.
- **Interactive Setup Prompt**: Asks `✨ Initialize RIG for this workspace? [Y/n]`.
  - **On Yes / Enter**:
    - Creates `.rig/sessions/` and `.rig/cache/`.
    - Generates `.rig/config.json` with model preferences and approval settings.
    - Generates `.rig/instructions.md` template for custom project-level agent rules.
    - Appends `.rig/sessions/`, `.rig/cache/`, and `.rig/provider.json` to `.gitignore` to keep runtime data and credentials out of git.
  - **On No**: Runs in ephemeral mode without creating disk files.

### C. Core Agent Loop & Runtime
- **Multi-Step Execution**: Iterative loop (prompt → model → tool execution → observation → prompt update → final answer).
- **Safety Gating & Approvals**: Evaluates risk levels before executing tools; prompts user in terminal for permission on file writes and shell commands (bypassable with `--yes`).
- **Session Checkpointing**: Records append-only JSON Lines event logs (`events.jsonl`) and saves applied diffs as standalone `.patch` files in `.rig/sessions/<id>/patches/`.
- **Max Steps Safeguard**: Defaults to 30 steps with configurable CLI override (`--max-steps`).

### D. Model Client Layer
- **Universal Provider**: Supports standard OpenAI API (`OPENAI_API_KEY`), OpenRouter (`OPENROUTER_API_KEY`), or custom local OpenAI-compatible endpoints (`RIG_API_BASE_URL` / `OPENAI_BASE_URL`).
- **Dynamic Model Selection**: Configurable via `--model` flag or `RIG_MODEL` env var (default: `gpt-4o-mini`).
- **Mock Model Fallback**: Deterministic mock client for offline development and testing.
- **Provider Configuration**: Workspace-local provider settings are loaded automatically by the agent loop; credentials are written with user-only file permissions.

### E. Tool System
| Tool | Risk Level | Description |
|---|---|---|
| `list_files` | `read_only` | Directory listing with dotfile filtering. |
| `read_file` | `read_only` | UTF-8 text reader with line-range slicing and file size limits. |
| `search_text` | `read_only` | Ripgrep-powered text/regex search with case sensitivity options. |
| `git_status` | `read_only` | Branch and modified file tracking. |
| `git_diff` | `read_only` | Staged and unstaged git diff extraction. |
| `write_patch` | `workspace_write` | Unified diff patch applier with path traversal protection (`../`). |
| `run_shell` | `shell_write` | Timeout-managed command runner with output truncation. |

### F. Safety & Policy Engine
- **Risk Tiers**: `read_only`, `workspace_write`, `shell_verify`, `shell_write`, `dangerous`, `network`.
- **Command Risk Classifier**: Identifies and guards against high-risk commands (`rm -rf`, `git reset --hard`, `git clean -fd`, pipes to bash, etc.).

### G. npm Package & Global CLI Architecture
- **Global Link**: Installed globally on local machine via `npm link` so `rig` runs from any directory.
- **Dual Export**: Functions both as a global CLI binary (`dist/cli/index.js`) and an importable TypeScript SDK (`dist/index.js`).
- **Prepack Verification**: Automatically builds and runs all unit tests before any `npm publish` / packaging.

### H. Optional MCU Plugin
- **Profiles**: Arduino, ESP32 Arduino/PlatformIO, and ESP32 ESP-IDF.
- **Onboarding**: `setupMcuWorkspace` detects existing setup, writes `.rig/plugins/mcu.json`, and avoids overwriting files unless explicitly requested.
- **Generated Files**: Platform-specific starter sources, build configuration, and `README.mcu.md`.

---

## 4. File Structure

```text
rig/
├── .gitignore
├── LICENSE                          # MIT License
├── package.json                     # Dual CLI & SDK configuration
├── PROGRESS.md                      # This progress report
├── README.md                        # Package documentation & quickstart
├── rig-project-specification.md     # Full architectural specification
├── tsconfig.json                    # TypeScript compiler configuration
├── src/
│   ├── index.ts                     # Root SDK entrypoint
│   ├── cli/
│   │   ├── index.ts                 # CLI entrypoint & interactive REPL engine
│   │   └── render.ts                # Cyberpunk TUI renderer & theme engine
│   ├── config/
│   │   ├── workspace-setup.ts       # First-run onboarding & workspace setup
│   │   ├── mcu-setup.ts             # Optional Arduino/ESP32 scaffolding
│   │   └── provider-setup.ts         # Provider persistence and loading
│   ├── context/
│   │   └── context-engine.ts        # Workspace context & system prompt builder
│   ├── core/
│   │   ├── agent-loop.ts            # Iterative agent execution loop
│   │   ├── agent-types.ts           # Core types, events, and results
│   │   ├── errors.ts                # Structured error classes
│   │   ├── events.ts                # Session event schemas
│   │   └── session.ts               # SessionManager & JSONL logger
│   ├── model/
│   │   ├── message-types.ts         # Message schema types
│   │   ├── mock-model.ts            # Deterministic mock client
│   │   ├── model-client.ts          # Universal ModelClient interface
│   │   └── openai-client.ts         # OpenAI/OpenRouter client
│   ├── safety/
│   │   └── policy.ts                # Safety policy & command risk classifier
│   └── tools/
│       ├── git.ts                   # git_status & git_diff tools
│       ├── read-only.ts             # list_files, read_file, search_text
│       ├── registry.ts              # ToolRegistry with Zod to JSON-schema conversion
│       ├── run-shell.ts             # run_shell runner with timeouts
│       ├── tool-types.ts            # Tool & ToolContext interfaces
│       └── write-patch.ts           # write_patch unified diff applier
├── tests/
│   ├── agent-loop.test.ts           # Multi-step loop & approval tests
│   ├── policy.test.ts               # Safety risk classification tests
│   ├── render.test.ts               # Box geometry & cursor calculation tests
│   ├── run-shell.test.ts            # Shell runner execution & timeout tests
│   ├── session.test.ts              # Session persistence & JSONL tests
│   ├── setup.test.ts                # Workspace onboarding & gitignore tests
│   ├── mcu-setup.test.ts             # MCU scaffolding tests
│   ├── provider-setup.test.ts        # Provider persistence tests
│   ├── tools.test.ts                # Tool registry lookup tests
│   └── write-patch.test.ts          # Patch parsing & boundary security tests
└── dist/                            # Compiled production bundles & .d.ts types
```

---

## 5. Verification & Quality Metrics

| Check | Result | Details |
|---|---|---|
| **TypeScript Compilation** | ✅ **Clean (0 errors)** | `tsc --noEmit` |
| **Unit & Integration Tests** | ✅ **24 / 24 Passing** | `vitest run` (10 test suites) |
| **Production Build** | ✅ **Built in ~60ms** | `tsup` ESM bundles + `.d.ts` types |
| **npm Package Dry Run** | ✅ **73.7 kB unpacked** | Whitelisted `dist`, `README`, `LICENSE` |
| **Global CLI (`npm link`)** | ✅ **Verified** | Works globally across any local directory |

---

## 6. Next Steps / Remaining Roadmap

1. **Phase 4 — Code Review Workflow (`rig review`)**:
   - Inspect staged / unstaged diffs and output severity-ranked findings (P1/P2/P3) for bugs, security risks, or missing test coverage.
2. **Phase 5 — Session Resumability (`rig resume`, `rig status`, `rig log`)**:
   - Resume stopped or interrupted sessions from `.rig/sessions/`.
   - Inspect event logs, patch histories, and summaries.
3. **Live Token Streaming**:
   - Real-time token streaming from providers during model generation.
4. **npm Registry Release**:
   - Publishing `rig-agent-harness` to npm when product milestones are completed.
