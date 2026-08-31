# RIG

> **A terminal-native AI harness for autonomous agents.**

RIG is a local-first command-line harness that lets AI agents inspect software repositories, build execution plans, run tools, edit files via structured unified diff patches, verify results with shell commands, and report outcomes through an observable and safety-aware execution loop.

---

## Features

- 🖥️ **Terminal-Native TUI**: Cyberpunk-inspired interface with responsive controls, traffic light tab indicators, ambient particles, and clean status views.
- ⚡ **Autonomous Execution Loop**: Multi-step inspect → plan → patch → verify → summarize cycle.
- 🛡️ **Safety & Policy Gating**: Dangerous command blocking (`rm -rf`, `git reset --hard`, destructive shell pipelines) and interactive approval prompts.
- 📝 **Structured Patch Editing**: Uses unified diffs (`write_patch`) with workspace boundary enforcement to prevent path traversal.
- 🧪 **Shell Verification**: Runs test suites (`vitest`, `jest`, `pytest`, `cargo test`) and linters with timeout protection and output truncation.
- 🌐 **Universal Model Support**: Works seamlessly with OpenAI (`OPENAI_API_KEY`), OpenRouter (`OPENROUTER_API_KEY`), or custom local endpoints (`RIG_API_BASE_URL`).
- 💬 **Persistent CLI Conversation**: Keeps prompts and responses in terminal scrollback with a bottom-anchored input box and themed thinking indicator.
- 🔌 **Optional MCU Scaffolding**: Generates Arduino and ESP32 project files only when embedded tooling is selected.
- 📦 **Dual Package Design**: Use as a global CLI (`npx rig`) or import directly into your TypeScript/Node.js applications as a library SDK.

---

## Installation

### Run directly with npx
```bash
npx rig-agent-harness
```

### Install globally
```bash
npm install -g rig-agent-harness
rig --help
```

---

## Configuration

Set your model provider API key in your environment:

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."

# Or OpenRouter
export OPENROUTER_API_KEY="sk-or-..."

# Optional: Choose model (default: gpt-4o-mini)
export RIG_MODEL="gpt-4o"

# Optional: Custom OpenAI-compatible local endpoint (e.g. Ollama, vLLM, LiteLLM)
export RIG_API_BASE_URL="http://localhost:11434/v1"
```

### Optional MCU Plugin Setup

RIG can also scaffold optional embedded-project files for MCU workflows without forcing every workspace into a hardware setup.

```ts
import { setupMcuWorkspace } from "rig-agent-harness";

await setupMcuWorkspace({
  workspace: process.cwd(),
  profile: "esp32-arduino",
  board: "esp32dev",
  template: "minimal",
});
```

Supported profiles:
- `arduino`
- `esp32-arduino`
- `esp32-idf`

This creates a `.rig/plugins/mcu.json` manifest and adds starter files such as `sketch.ino`, `platformio.ini`, `src/main.cpp`, or `CMakeLists.txt` depending on the selected profile.

### Linking an AI Provider

From the interactive CLI, type `/provider`, choose a provider with the arrow keys, and enter its API key. RIG stores the credential locally in `.rig/provider.json`, which is ignored by git and restricted to the current user.

Supported providers:
- **OpenAI**
- **OpenRouter**
- **Ollama (local)** — no API key required
- **Custom endpoint** — OpenAI-compatible services

The provider configuration is loaded automatically for subsequent `ask`, `run`, and interactive prompts. If no provider is configured, RIG uses its deterministic mock client for offline testing.

### Choosing an AI Model

In interactive mode, type `/model`. RIG queries the configured provider's OpenAI-compatible `/models` endpoint, then lets you browse the models returned by that provider with the arrow keys. Press Enter to select one. The choice is stored locally in `.rig/model.json` and is used for later prompts. If no provider is configured or discovery fails, RIG shows offline fallback presets instead. You can also override the model for one command with:

```bash
rig ask "Explain this repository" --model gpt-4o
```

---

## CLI Usage

### Interactive Mode (TUI)
Simply run `rig` to start the cyberpunk terminal user interface:
```bash
rig
```

### Ask Questions About a Codebase
```bash
rig ask "How does authentication and session management work in this repo?"
```

### Run an Autonomous Task
```bash
rig run "Add a --json output flag to the reports command"
```

### Auto-approve Changes
```bash
rig run "Fix failing unit tests in the auth module" --yes
```

### Other Commands

```bash
rig review   # Review current workspace changes
rig resume   # Resume a saved session
rig status   # Show workspace and session status
rig log      # Inspect a saved session log
rig config   # View RIG configuration
```

Inside interactive mode:
- `/provider` opens the provider selection popup.
- `/help` shows available commands.
- `/clear` resets the current conversation.
- `/exit` or `/quit` exits RIG.

When RIG is working, a themed animated spinner is shown. Risky file writes and shell commands can request approval unless `--yes` is used.

### CLI Options
- `-y, --yes`: Auto-approve all write and verification actions.
- `-m, --model <model>`: Specify model name for this run.
- `--max-steps <number>`: Limit maximum agent loop steps (default: 30).
- `--json`: Output machine-readable JSON results.
- `--no-color`: Disable terminal colors and styling.

---

## Programmatic SDK Usage

You can also use RIG inside your own Node.js / TypeScript projects:

```typescript
import { runAgentLoop, OpenAIClient } from "rig-agent-harness";

const result = await runAgentLoop({
  task: "Find and fix type errors in src/api/",
  workspace: process.cwd(),
  maxSteps: 15,
  autoApprove: false,
  onApprovalRequest: async (req) => {
    console.log(`Permission requested for ${req.tool}:`, req.arguments);
    return true; // approve
  },
  onTurn: (event) => {
    console.log("Agent event:", event.type);
  },
});

console.log("Status:", result.status);
console.log("Summary:", result.message);
console.log("Files changed:", result.filesChanged);
```

---

## Architecture

```text
┌────────────────────────────────────────────────────────────┐
│                    Terminal TUI / CLI                      │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                    Agent Runtime Loop                      │
│   inspect -> plan -> act -> observe -> verify -> repeat    │
└───────────────┬──────────────────────────────┬─────────────┘
                │                              │
┌───────────────▼──────────────┐   ┌───────────▼─────────────┐
│         Model Client         │   │      Context Engine     │
│  OpenAI / OpenRouter / Mock  │   │  workspace, git status  │
└──────────────────────────────┘   └───────────┬─────────────┘
                                               │
┌──────────────────────────────────────────────▼─────────────┐
│                 Tool System & Safety Policy                │
│  list_files, read_file, search_text, git_status, git_diff, │
│  write_patch (diff applier), run_shell (timeout-protected) │
└────────────────────────────────────────────────────────────┘
```

---

## License

MIT © [RIG Contributors](LICENSE)
