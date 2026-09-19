# RIG

> **A terminal AI agent that works on real codebases — including firmware.**

Most coding agents quietly assume you're in a web app. They want a `package.json`, they
guess at frameworks, and they fall apart on a `platformio.ini` and a `src/main.cpp`.

RIG is a local-first coding agent for the terminal. Point it at a repository, describe the
task, and it inspects, edits, runs commands, and reports back — with first-class support for
**embedded projects** (Arduino, ESP32, PlatformIO, ESP-IDF) and a safety model that fails
closed instead of guessing.

```bash
npx rig-agent-harness
```

---

## Demo

```console
$ rig run "the sketch fails to compile — find and fix it"

  ◆ list_files · ./
  ◆ read_file · platformio.ini
  ◆ search_text · ledPin
  ◆ run_shell · pio run
  ✗ error: 'ledPin' was not declared in this scope

  ✎ write_patch · src/main.cpp   (+2 -1)
  ◆ run_shell · pio run
  ✓ SUCCESS

  Fixed: ledPin was used in setup() before its #define. Moved the
  definition above setup(). pio run now builds clean.
```

*(abbreviated — the tool lines are real, the summary is the model's own wording)*

<!-- To add a GIF: record a terminal session with `asciinema` or Kap, save it as
     assets/demo.gif, then uncomment the line below and delete this comment block.

![RIG in action](assets/demo.gif)

-->

---

## Quick start

```bash
# 1. Run it (no install)
npx rig-agent-harness

# 2. Or install globally
npm install -g rig-agent-harness
rig --help

# 3. Give it a provider
export OPENAI_API_KEY="sk-..."          # or OPENROUTER_API_KEY, or a local endpoint
rig ask "how does auth work in this repo?"
```

Prefer to keep credentials out of your shell? Run `rig` and type `/provider` — RIG stores the
key in `.rig/provider.json` (mode `0600`, git-ignored).

---

## Why RIG

**It fails closed.** When a tool needs approval and nothing can grant it, RIG refuses the
action and reports the refusal back to the model. It does not execute it and hope. The same
applies to exit codes: if no real model produced the answer, the command exits non-zero.

**It tells you when it's broken.** If no provider is configured, RIG does not invent an
answer. Every message from the offline fallback is prefixed with `[offline fallback]` and
says plainly that no model was called — so a misconfigured setup always looks broken rather
than working. There is no hard-coded fallback model list to paper over a bad key.

**It's honest about what it changed.** Every run is recorded as an append-only event log with
the patches it applied, so `rig log` and `rig resume` show you what actually happened.

**It works on embedded repos.** See below — this is the part nobody else does.

---

## Embedded & MCU projects

Firmware repos break most agents: no `package.json`, a build system they don't recognise,
and toolchain errors they can't parse. RIG treats them as first-class.

```ts
import { setupMcuWorkspace } from "rig-agent-harness";

await setupMcuWorkspace({
  workspace: process.cwd(),
  profile: "esp32-arduino",   // or "arduino" | "esp32-idf"
  board: "esp32dev",
  template: "minimal",
});
```

This writes a `.rig/plugins/mcu.json` manifest and scaffolds the right starter files for the
profile — `sketch.ino`, `platformio.ini`, `src/main.cpp`, or `CMakeLists.txt`.

| Profile | Scaffolds |
|---|---|
| `arduino` | `sketch.ino` |
| `esp32-arduino` | `platformio.ini`, `src/main.cpp` |
| `esp32-idf` | `CMakeLists.txt`, `main/CMakeLists.txt`, `main/main.cpp` |

Once scaffolded, `rig run "add a debounce to the button handler"` works the same way it
would on a TypeScript repo — inspect, patch, build, verify.

---

## Features

- 🖥️ **Terminal-native TUI** — full-screen interface, or a plain line-oriented REPL when you
  pipe into it (so it behaves in CI).
- ⚡ **Autonomous loop** — inspect → plan → patch → verify → summarise, up to a step limit.
- 🛡️ **Fail-closed safety** — dangerous command blocking (`rm -rf`, `git reset --hard`,
  destructive pipelines, `curl | sh`) with interactive approval for everything else.
- 📝 **Structured edits** — unified-diff patches via `write_patch`, with workspace boundary
  enforcement against path traversal.
- 🧪 **Shell verification** — runs test suites and linters with timeouts and output truncation.
- 🌐 **Any OpenAI-compatible provider** — OpenAI, OpenRouter, Ollama, vLLM, LiteLLM, or your
  own endpoint. (Anthropic is offered for model discovery only — see
  [Providers](#providers).)
- 💬 **Persistent sessions** — append-only JSONL event logs; `rig log`, `rig resume`.
- 📦 **CLI *and* SDK** — use it from the shell, or `import { runAgentLoop }` in your own code.

---

## Configuration

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."

# Or OpenRouter
export OPENROUTER_API_KEY="sk-or-..."

# Optional: default model (otherwise chosen per provider)
export RIG_MODEL="gpt-4o"

# Optional: any OpenAI-compatible local endpoint (Ollama, vLLM, LiteLLM)
export RIG_API_BASE_URL="http://localhost:11434/v1"
```

### Providers

From the interactive CLI, type `/provider` to pick one and enter its key. Supported:

- **OpenAI**
- **OpenRouter**
- **Ollama (local)** — no API key required
- **Custom endpoint** — any OpenAI-compatible service
- **Anthropic** — model discovery works (`x-api-key`, `/v1/models`). **The chat path is not
  implemented yet**: RIG speaks the OpenAI-compatible protocol only, so selecting Anthropic
  will not complete a request. Tracked as a known gap.

The configuration is loaded automatically for later `ask`, `run`, and interactive prompts.

### Choosing a model

Type `/model` in interactive mode. RIG queries the provider's `/models` endpoint, then lets
you browse and filter the results — Enter to select. The choice is stored in `.rig/model.json`
(git-ignored). If discovery fails, RIG shows an empty picker with a hint and deliberately
offers **no hard-coded fallback list**. Override per-command with:

```bash
rig ask "Explain this repository" --model gpt-4o
```

---

## CLI usage

```bash
rig                                              # interactive TUI
rig ask "How does session management work?"      # question, no edits
rig run "Add a --json flag to the reports command"   # autonomous task
rig run "Fix the failing auth tests" --yes       # auto-approve writes

rig config   # resolved provider, model, limits, approvals
rig log      # list sessions, or inspect one
rig resume   # continue the most recent unfinished session
rig review   # severity-ranked findings on the current diff
rig status   # workspace and provider/model status
```

`rig log` lists every recorded session; pass an id (or `last`) to inspect its timeline and
patch artifacts:

```bash
rig log
rig log last
rig log 2026-09-13T09-36-03-533Z-fix-the-build
```

`rig resume` prints what the previous attempt did, then continues the original task in the
same session. Use `--summary` to inspect without continuing:

```bash
rig resume
rig resume --summary
```

`rig review` feeds the current diff to the agent and asks for severity-ranked findings:

```bash
rig review                 # unstaged changes
rig review --staged        # staged changes
rig review --file src/api.ts
```

Inside interactive mode: `/provider`, `/model`, `/status`, `/help`, `/clear`, `/exit`.

### CLI options

- `-y, --yes` — auto-approve all write and verification actions.
- `-m, --model <model>` — model to use for this run.
- `--max-steps <number>` — limit agent loop steps (default: 30).
- `--json` — machine-readable output.
- `--no-color` — disable styling.

### Exit codes

RIG **fails closed** on its exit code. If a command that produces an answer did not actually
get one from a model, it exits `1` and explains why on stderr — so a script or CI job cannot
mistake a placeholder for a result.

| Exit | When |
|---|---|
| `0` | The command did what was asked, with a real model. |
| `1` | The command failed; it produced no real model output (no provider configured, or the provider could not be used); or `review` / `resume` ran outside a git repository or with no resumable session. |

This applies to `ask`, `run`, `review` and `resume`. Read-only commands (`status`, `config`,
`log`, `--version`, `--help`) exit `0`. The interactive TUI leaves the exit code alone, since
one offline turn should not end your session.

The warning goes to **stderr**, so `--json` on stdout stays parseable:

```bash
rig --json ask "how does auth work" > out.json   # still valid JSON, exit code 1
```

---

## Programmatic SDK usage

```typescript
import { runAgentLoop, isUnrealSource } from "rig-agent-harness";

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

console.log(result.status, result.filesChanged);

if (isUnrealSource(result.modelSource)) {
  // `result.message` is a scripted placeholder, not an answer.
  throw new Error("No model provider is configured.");
}
```

### Knowing whether a real model answered

`result.modelSource` reports where the output came from, so library callers can apply the same
fail-closed rule the CLI does:

| Value | Meaning |
|---|---|
| `"provider"` | A real remote model was configured and called. |
| `"offline"` | Nothing was configured, so the scripted offline client ran. |
| `"mock"` | A provider was configured but unusable, or a mock was injected. |

### Approval semantics

Tools classified as `workspace_write`, `shell_write`, `shell_verify`, `network` or
`dangerous` require approval. RIG **fails closed**: if a tool needs approval, `autoApprove` is
off, and no `onApprovalRequest` handler was supplied, the action is refused and the refusal is
reported back to the model instead of being executed. Pass `onApprovalRequest` to decide per
action, or set `autoApprove: true` to opt out of prompting entirely.

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
│  OpenAI-compatible:          │   │  workspace, git status  │
│  OpenAI / OpenRouter /       │   │                         │
│  Ollama / custom / mock      │   │                         │
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
