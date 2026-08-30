# RIG Project Specification

## Project Name

**RIG**

## Tagline

**A terminal-native AI harness for autonomous agents.**

## One-Line Description

RIG is a local-first command-line harness that lets AI agents inspect projects, plan work, run tools, edit files, verify results, and report outcomes through a structured, observable, and safety-aware execution loop.

## Product Thesis

Most AI coding tools behave like chat interfaces with tool access added afterward. RIG should feel different: it is not primarily a chatbot, but an execution harness.

An engineering rig is a controlled setup used to operate, test, measure, or evaluate a system. RIG applies that idea to AI agents. It gives a model a structured environment where it can reason, act, observe, recover, and produce useful work without losing control of the system it operates in.

RIG should be:

- **Terminal-native**: designed for shell workflows, not a web chat port.
- **Local-first**: reads and modifies local projects with explicit boundaries.
- **Observable**: every agent action is visible, logged, resumable, and auditable.
- **Tool-oriented**: the model does not magically act; it requests typed tools.
- **Safety-aware**: risky actions require permission, destructive changes are guarded, and user work is protected.
- **Composable**: tools, models, context providers, and policies can be swapped.
- **Pragmatic**: optimized for useful coding work, not demos.

## Target User

RIG is for developers who want an AI agent that can work inside real codebases from the terminal.

Primary users:

- Solo developers building projects quickly.
- Engineers maintaining existing repositories.
- Power users who prefer CLI workflows.
- Teams experimenting with autonomous coding agents.
- Builders who want a hackable agent harness rather than a locked product.

## Core Use Cases

### 1. Ask Questions About a Codebase

```bash
rig ask "how does authentication work?"
```

RIG inspects relevant files, summarizes findings, and cites paths.

### 2. Implement a Change

```bash
rig run "add a JSON export option to the reports command"
```

RIG plans, edits files, runs checks, and reports what changed.

### 3. Fix a Bug

```bash
rig run "the dashboard crashes when no projects exist, find and fix it"
```

RIG reproduces or locates the issue, patches the code, and verifies behavior.

### 4. Run a Code Review

```bash
rig review
```

RIG reviews the current diff and reports bugs, risks, and missing tests.

### 5. Continue Previous Work

```bash
rig resume
```

RIG loads the latest session state and continues from the last meaningful checkpoint.

## Non-Goals For MVP

RIG should avoid trying to become everything at once.

Out of scope for MVP:

- Full browser-based IDE.
- Multi-agent orchestration.
- Hosted cloud execution.
- Plugin marketplace.
- GUI app.
- Voice interface.
- Long-running background daemon.
- Complex memory graph.
- Enterprise policy engine.
- Remote repository automation.

These can come later, but the first version should prove that a local terminal harness can complete useful coding tasks reliably.

## MVP Definition

The MVP is successful when a user can run:

```bash
rig run "make a small code change in this repo"
```

And RIG can:

1. Inspect the repository.
2. Build a concise plan.
3. Ask for confirmation before editing.
4. Modify files.
5. Run a relevant verification command.
6. Summarize the result with changed files and test output.
7. Save a session log that can be resumed or inspected.

## MVP Scope

### Included

- CLI entrypoint.
- Local workspace detection.
- Model client abstraction.
- Core agent loop.
- Tool-call protocol.
- File read/search/list tools.
- Patch-based file editing.
- Shell command execution with safety gates.
- Session logging.
- Basic resumability.
- User approval prompts.
- Git diff awareness.
- Final response summaries.

### Excluded

- Multiple concurrent agents.
- Remote sandbox execution.
- Fine-grained RBAC.
- Web UI.
- Project indexing service.
- Vector database.
- Background scheduling.
- Cloud sync.

## Design Principles

### 1. The Model Proposes, The Harness Disposes

The model should not directly mutate the machine. It should request tool calls. The harness validates each request, enforces policy, executes the tool, and returns observations.

### 2. Every Action Should Be Replayable Enough To Debug

RIG does not need perfect deterministic replay in MVP, but it should record:

- User request.
- Model messages.
- Tool calls.
- Tool outputs.
- File edits.
- Approvals.
- Verification results.
- Final answer.

### 3. File Edits Should Be Structured

Prefer patch-based edits over freeform overwrites. This makes changes reviewable and reduces accidental loss of user work.

### 4. Protect User Work

Before editing, RIG should detect:

- Dirty git state.
- Files modified outside the current session.
- Potentially destructive operations.
- Commands that delete, reset, install, publish, deploy, or expose secrets.

### 5. Keep The CLI Calm

The terminal UX should be readable and restrained. RIG should show what it is doing without dumping noisy raw internals unless requested.

## High-Level Architecture

```text
┌────────────────────────────────────────────────────────────┐
│                          CLI                               │
│  parse args, render output, prompt user, stream progress    │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                     Session Manager                        │
│  creates runs, stores logs, restores checkpoints, tracks id │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                      Agent Runtime                         │
│  builds prompts, runs loop, handles tool calls, finalizes   │
└───────────────┬──────────────────────────────┬─────────────┘
                │                              │
┌───────────────▼──────────────┐   ┌───────────▼─────────────┐
│          Model Client         │   │       Context Engine     │
│  OpenAI/local/etc abstraction │   │ files, git, summaries    │
└──────────────────────────────┘   └───────────┬─────────────┘
                                               │
┌──────────────────────────────────────────────▼─────────────┐
│                       Tool System                          │
│ read files, search, patch, shell, git, approvals, policies  │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                    Local Environment                       │
│ filesystem, shell, git repo, package manager, test runner   │
└────────────────────────────────────────────────────────────┘
```

## Main Components

### CLI

Responsibilities:

- Parse commands and options.
- Detect current working directory.
- Start or resume sessions.
- Render progress updates.
- Display approval prompts.
- Print final summaries.

Example commands:

```bash
rig ask "what does this project do?"
rig run "add pagination to the users endpoint"
rig review
rig status
rig resume
rig log
rig config
```

### Session Manager

Responsibilities:

- Create a unique session per user request.
- Persist session data under `.rig/sessions`.
- Track run status: `running`, `waiting_for_approval`, `completed`, `failed`, `cancelled`.
- Save structured event logs.
- Support resume from latest or specified session.

Suggested session layout:

```text
.rig/
  config.toml
  sessions/
    2026-08-29T12-30-15Z-add-json-export/
      session.json
      events.jsonl
      transcript.md
      patches/
        001.patch
      artifacts/
        test-output.txt
```

### Agent Runtime

Responsibilities:

- Build system and task prompts.
- Select relevant context.
- Call the model.
- Parse tool requests.
- Execute tools through the tool router.
- Feed observations back to the model.
- Stop when the model returns a final answer or a configured limit is reached.

The runtime owns the core loop.

### Model Client

Responsibilities:

- Provide a stable interface over different model providers.
- Support streaming text.
- Support structured tool calls.
- Normalize errors and retries.

Initial provider:

- OpenAI Responses API or Chat Completions-compatible client.

Future providers:

- Local models.
- Anthropic-compatible adapters.
- Ollama.
- LiteLLM-style proxy.

### Context Engine

Responsibilities:

- Summarize repository structure.
- Include relevant files.
- Track previous observations.
- Manage token budget.
- Include git diff and status.
- Keep durable summaries across long sessions.

MVP context sources:

- Current working directory.
- Git status.
- Directory tree.
- Search results.
- Files explicitly read during the session.
- Recent tool outputs.

### Tool System

Responsibilities:

- Register tools with schemas.
- Validate tool arguments.
- Apply safety policies.
- Execute tool handlers.
- Return structured observations.

MVP tools:

- `list_files`
- `read_file`
- `search_text`
- `write_patch`
- `run_shell`
- `git_status`
- `git_diff`
- `ask_user`

### Safety Policy

Responsibilities:

- Classify tool calls by risk.
- Require approval for risky actions.
- Block known-dangerous operations by default.
- Prevent edits outside the workspace.
- Protect dirty user changes.

## Suggested Tech Stack

### Language

Use **TypeScript** for the first version.

Reasons:

- Strong CLI ecosystem.
- Good JSON/schema ergonomics.
- Easy model SDK integration.
- Good cross-platform support.
- Familiar to many vibecoding workflows.

Alternative:

- Rust is attractive for a polished CLI, but TypeScript will be faster for early iteration.

### Runtime

- Node.js 22+
- pnpm or npm

### CLI Framework

Recommended:

- `commander` for simple command parsing.
- `ink` only later if a richer terminal UI becomes necessary.

### Validation

- `zod` for config, tool args, event logs, and model output validation.

### Terminal Output

- `chalk` for color.
- `ora` or simple custom spinners.
- `prompts` or `@inquirer/prompts` for approvals.

### File Operations

- Node `fs/promises`.
- `fast-glob` for file discovery.
- `ignore` for `.gitignore` handling.

### Patching

- Start with unified diff generation and application.
- Use a library if reliable, or shell out to `git apply --check` and `git apply` when inside a git repo.

### Testing

- `vitest` for unit tests.
- Fixture repositories for integration tests.

### Packaging

- `tsx` for local development.
- `tsup` for building.
- npm package with `bin` entry.

## Proposed Directory Structure

```text
rig/
  package.json
  tsconfig.json
  README.md
  .gitignore
  src/
    cli/
      index.ts
      commands/
        ask.ts
        run.ts
        review.ts
        resume.ts
        status.ts
        config.ts
      render/
        console.ts
        prompts.ts
        format.ts
    core/
      agent-loop.ts
      agent-types.ts
      session.ts
      events.ts
      errors.ts
    model/
      model-client.ts
      openai-client.ts
      message-types.ts
    context/
      context-engine.ts
      repo-summary.ts
      token-budget.ts
      file-cache.ts
    tools/
      registry.ts
      tool-types.ts
      list-files.ts
      read-file.ts
      search-text.ts
      write-patch.ts
      run-shell.ts
      git.ts
      ask-user.ts
    safety/
      policy.ts
      risk.ts
      approvals.ts
      workspace-boundary.ts
    config/
      config.ts
      defaults.ts
      load-config.ts
    utils/
      paths.ts
      jsonl.ts
      logger.ts
      child-process.ts
  tests/
    unit/
    integration/
    fixtures/
      simple-node-project/
      dirty-git-project/
```

## Core Agent Loop

The core loop is the heart of RIG.

### Loop Responsibilities

1. Receive the user task.
2. Load session and workspace context.
3. Send prompt to the model.
4. Receive either:
   - natural-language final response, or
   - one or more tool calls.
5. Validate tool calls.
6. Run safety checks.
7. Ask user approval when needed.
8. Execute allowed tools.
9. Append observations to the session.
10. Repeat until done or stopped.

### Pseudocode

```ts
async function runAgentLoop(input: AgentInput): Promise<AgentResult> {
  const session = await sessionManager.createOrResume(input);
  const context = await contextEngine.buildInitialContext(input.workspace);

  while (!session.shouldStop()) {
    const modelInput = promptBuilder.build({
      task: input.task,
      context,
      events: session.recentEvents(),
      tools: toolRegistry.definitions(),
    });

    const response = await modelClient.generate(modelInput);
    await session.recordModelResponse(response);

    if (response.type === "final") {
      await session.complete(response.message);
      return { status: "completed", message: response.message };
    }

    for (const toolCall of response.toolCalls) {
      const tool = toolRegistry.get(toolCall.name);
      const args = tool.schema.parse(toolCall.arguments);

      const risk = safetyPolicy.classify(toolCall.name, args);

      if (risk.requiresApproval) {
        const approved = await approvals.request({ toolCall, risk });
        await session.recordApproval(toolCall, approved);

        if (!approved) {
          await session.recordObservation(toolCall, {
            ok: false,
            message: "User denied approval.",
          });
          continue;
        }
      }

      const observation = await tool.execute(args, {
        workspace: input.workspace,
        session,
      });

      await session.recordObservation(toolCall, observation);
      await contextEngine.updateFromObservation(context, toolCall, observation);
    }
  }

  return {
    status: "stopped",
    message: "Agent stopped before completion.",
  };
}
```

## Tool System Design

Each tool should have:

- Name.
- Description.
- Zod argument schema.
- Risk classifier metadata.
- Execution handler.
- Structured result schema.

Example:

```ts
const readFileTool = defineTool({
  name: "read_file",
  description: "Read a UTF-8 text file from the current workspace.",
  args: z.object({
    path: z.string(),
    startLine: z.number().optional(),
    endLine: z.number().optional(),
  }),
  risk: "read_only",
  async execute(args, ctx) {
    const safePath = ctx.workspace.resolvePath(args.path);
    const content = await readTextRange(safePath, args);
    return {
      ok: true,
      content,
    };
  },
});
```

## MVP Tool Details

### `list_files`

Lists files in the workspace while respecting ignore rules.

Risk:

- Read-only.

Arguments:

- `path`
- `maxDepth`
- `includeHidden`

### `read_file`

Reads text from a file.

Risk:

- Read-only.

Arguments:

- `path`
- `startLine`
- `endLine`

Limits:

- Max file size.
- Max returned lines.
- Binary detection.

### `search_text`

Searches for text or regex patterns.

Risk:

- Read-only.

Arguments:

- `query`
- `path`
- `regex`
- `caseSensitive`
- `maxResults`

Implementation:

- Prefer ripgrep when available.
- Fallback to JS search.

### `write_patch`

Applies a unified diff patch.

Risk:

- Workspace write.
- Requires approval in interactive mode.

Arguments:

- `patch`
- `reason`

Safety:

- Rejects paths outside workspace.
- Runs patch check before applying.
- Records patch file in session.
- Warns when target files changed since read.

### `run_shell`

Runs a shell command in the workspace.

Risk:

- Varies by command.

Arguments:

- `command`
- `timeoutMs`
- `reason`

Risk classes:

- `safe_read`: `ls`, `pwd`, `git status`, `git diff`.
- `verify`: `npm test`, `pnpm test`, `cargo test`, `pytest`.
- `write`: install/build/generate commands.
- `network`: commands likely to access network.
- `dangerous`: delete/reset/deploy/secrets commands.

### `git_status`

Returns concise git status.

Risk:

- Read-only.

### `git_diff`

Returns current diff.

Risk:

- Read-only.

### `ask_user`

Asks the user a clarification question.

Risk:

- No system risk.

Use sparingly. RIG should ask only when a decision cannot reasonably be made.

## Safety Model

Safety is a first-class feature, not a prompt-only behavior.

### Risk Levels

```text
read_only
  Cannot modify files or system state.

workspace_write
  Can modify files inside the current workspace.

shell_verify
  Runs commands expected to verify state, such as tests.

shell_write
  Runs commands that may create or modify files.

network
  May access remote systems.

dangerous
  Can delete data, reset history, expose secrets, deploy, publish, or change external state.
```

### Default MVP Policy

| Action | Default Behavior |
|---|---|
| Read files | Allow |
| Search files | Allow |
| Git status/diff | Allow |
| Apply patch | Ask approval |
| Run tests | Ask approval first, then remember for session |
| Install packages | Ask approval |
| Network command | Ask approval |
| Delete files | Ask approval with stronger warning |
| Git reset/checkout clean | Block unless explicitly requested |
| Deploy/publish | Block by default |
| Read `.env` or secret-looking files | Ask approval or redact |

### Workspace Boundary

RIG should only read and write inside the workspace unless explicitly configured.

Path handling rules:

- Normalize all paths.
- Resolve symlinks where possible.
- Reject `..` escapes.
- Reject absolute paths outside workspace.
- Treat hidden files as readable only when necessary.

### Dirty Worktree Protection

Before editing, RIG should inspect git status.

If files are already modified:

- RIG may still work.
- It must avoid overwriting unrelated changes.
- It should mention dirty files in the plan.
- It should record which files it touched.

### Approval UX

Example:

```text
RIG wants to modify files:

Reason:
Add JSON export support to the reports command.

Files:
- src/reports/export.ts
- tests/reports/export.test.ts

Approve? [y/N]
```

For shell commands:

```text
RIG wants to run:
npm test -- reports

Reason:
Verify the reports export behavior.

Approve? [y/N]
```

## State And Context Handling

RIG needs both short-term session state and lightweight persistent project state.

### Session State

Stored per run.

Includes:

- User task.
- Working directory.
- Start/end time.
- Model used.
- Tool calls.
- Observations.
- Approvals.
- Patches.
- Final result.

### Event Log

Use JSON Lines for append-only event storage.

Example:

```json
{"type":"session_started","timestamp":"2026-08-29T12:30:15Z","task":"add JSON export"}
{"type":"tool_called","tool":"read_file","args":{"path":"src/index.ts"}}
{"type":"tool_observation","tool":"read_file","ok":true,"summary":"Read 120 lines"}
{"type":"approval_requested","risk":"workspace_write"}
{"type":"approval_resolved","approved":true}
{"type":"patch_applied","path":"patches/001.patch"}
{"type":"session_completed","status":"completed"}
```

### Project State

Stored under `.rig`.

Includes:

- Config.
- Session history.
- Optional cached repo summary.
- Optional per-project instructions.

Suggested files:

```text
.rig/
  config.toml
  instructions.md
  sessions/
  cache/
    repo-summary.json
```

### Context Budget Strategy

MVP strategy:

- Keep full task and recent events.
- Include compact git status.
- Include files read in the current session if small.
- Summarize long outputs.
- Truncate large files with line ranges.
- Let the model request more files through tools.

Future strategy:

- Add file relevance ranking.
- Add semantic index.
- Add durable summaries.
- Add task-specific memory.

## CLI UX

### Command Shape

```bash
rig [command] [input] [options]
```

Commands:

```bash
rig ask "question"
rig run "task"
rig review
rig resume [session-id]
rig status
rig log [session-id]
rig config get
rig config set model gpt-5
```

### Global Options

```bash
--model <name>
--cwd <path>
--yes
--dry-run
--json
--verbose
--no-color
--max-steps <number>
```

### Example Output

```text
RIG

Task:
Add JSON export support to the reports command.

Inspecting workspace...
Found Node project with npm scripts: test, build, lint

Plan:
1. Inspect reports command implementation.
2. Add JSON output mode.
3. Add focused tests.
4. Run report tests.

Approval required to edit 2 files.
Approve? [y/N]
```

### Final Summary

```text
Completed.

Changed:
- src/reports/export.ts
- tests/reports/export.test.ts

Verified:
- npm test -- reports

Notes:
- Added `--format json`.
- Existing text output behavior is unchanged.

Session:
.rig/sessions/2026-08-29T12-30-15Z-add-json-export
```

## Configuration

Suggested `.rig/config.toml`:

```toml
[model]
provider = "openai"
name = "gpt-5"

[workspace]
respect_gitignore = true
max_file_bytes = 200000

[approvals]
patches = true
shell_commands = true
network = true
dangerous = false

[limits]
max_steps = 30
tool_timeout_ms = 120000
max_output_chars = 30000
```

Environment variables:

```bash
OPENAI_API_KEY=...
RIG_MODEL=gpt-5
RIG_CONFIG=/path/to/config.toml
```

## Prompting Strategy

RIG should maintain a concise system prompt that describes:

- The agent's role.
- Tool-use rules.
- Safety limits.
- How to report progress.
- How to handle dirty worktrees.
- How to produce final summaries.

The system prompt should not be the only safety layer. The harness must enforce policy in code.

### Agent Behavioral Contract

The model should:

- Inspect before editing.
- Prefer small, focused changes.
- Use existing project conventions.
- Explain plans before risky actions.
- Run verification when feasible.
- Report exact files changed.
- Admit when verification was not possible.
- Avoid unrelated refactors.

## Example Flow: Implement A Feature

Command:

```bash
rig run "add a --json flag to the stats command"
```

Flow:

1. RIG creates a session.
2. RIG reads git status.
3. RIG lists top-level files.
4. Model searches for `stats` command.
5. Model reads relevant command and test files.
6. Model proposes a plan.
7. RIG asks for approval to apply patch.
8. Patch is applied.
9. Model requests `npm test -- stats`.
10. RIG asks for command approval.
11. Tests run.
12. Model fixes any failures.
13. RIG prints final summary.

## Example Flow: Code Review

Command:

```bash
rig review
```

Flow:

1. RIG reads git diff.
2. RIG identifies changed files.
3. Model inspects surrounding code.
4. Model reports findings by severity.
5. No edits are made unless user runs a fix command.

Output style:

```text
Findings:

P1 src/auth/session.ts:88
Expired sessions are accepted when `expiresAt` is undefined. This changes the existing default-deny behavior and may keep invalid sessions alive.

P2 tests/auth/session.test.ts
No test covers the missing `expiresAt` case.
```

## Example Flow: Resume

Command:

```bash
rig resume
```

Flow:

1. RIG locates latest incomplete session.
2. RIG loads event log.
3. RIG checks current git status.
4. RIG warns if files changed since previous session.
5. Model receives compact session summary.
6. Work continues.

## Phased Roadmap

### Phase 0: Project Skeleton

Goal:

Create a runnable CLI with a minimal internal architecture.

Tasks:

- Create package.
- Add TypeScript config.
- Add CLI entrypoint.
- Add basic command parser.
- Add config loading.
- Add event logger.
- Add test framework.

Exit criteria:

- `rig --help` works.
- `rig ask "hello"` reaches a stub model or mock model.
- Unit tests run.

### Phase 1: Read-Only Agent

Goal:

Allow RIG to inspect projects and answer questions without modifying files.

Tasks:

- Implement model client.
- Implement agent loop.
- Implement tool registry.
- Add `list_files`.
- Add `read_file`.
- Add `search_text`.
- Add `git_status`.
- Add session logs.
- Add output rendering.

Exit criteria:

- `rig ask "what does this repo do?"` can inspect files and answer with path references.
- Tool calls are recorded in `events.jsonl`.

### Phase 2: Patch-Based Editing

Goal:

Allow controlled file modifications.

Tasks:

- Add `write_patch`.
- Add patch validation.
- Add workspace boundary checks.
- Add approval prompts.
- Add dirty worktree detection.
- Store applied patches.
- Add final changed-files summary.

Exit criteria:

- `rig run "make a simple edit"` can apply a patch after approval.
- RIG refuses paths outside the workspace.
- RIG records the patch.

### Phase 3: Verification Commands

Goal:

Allow RIG to run tests and checks.

Tasks:

- Add `run_shell`.
- Add command risk classification.
- Add command timeouts.
- Add output truncation.
- Add approval memory for repeated commands in one session.
- Detect common project scripts.

Exit criteria:

- RIG can run a focused test command after approval.
- Long output is summarized safely.
- Failed commands are returned to the model for repair.

### Phase 4: Review Mode

Goal:

Add a dedicated review workflow.

Tasks:

- Add `rig review`.
- Load git diff.
- Inspect changed files.
- Produce severity-ranked findings.
- Avoid editing in review mode.
- Add review-specific output format.

Exit criteria:

- RIG can review the current diff and produce actionable findings.

### Phase 5: Resumability

Goal:

Allow interrupted sessions to continue.

Tasks:

- Add `rig status`.
- Add `rig log`.
- Add `rig resume`.
- Build session summaries.
- Detect workspace changes since last run.

Exit criteria:

- A stopped session can be resumed with enough context to continue safely.

### Phase 6: Quality Hardening

Goal:

Make RIG reliable on real repositories.

Tasks:

- Add integration fixture repos.
- Add file size and binary guards.
- Improve token budgeting.
- Improve shell command classifier.
- Add config documentation.
- Add crash recovery.
- Add structured errors.

Exit criteria:

- RIG handles common repo shapes without crashing.
- Failed tool calls produce useful recovery information.

## Implementation Task Breakdown

### Initial Setup

- Initialize Node project.
- Add TypeScript.
- Add `tsx`, `tsup`, `vitest`.
- Add linting and formatting.
- Add `bin` entry in `package.json`.
- Create `src/cli/index.ts`.
- Wire `rig --help`.

### Core Types

- Define `AgentInput`.
- Define `AgentResult`.
- Define `Session`.
- Define `SessionEvent`.
- Define `ToolDefinition`.
- Define `ToolCall`.
- Define `ToolObservation`.
- Define `RiskLevel`.

### Session Logging

- Create `.rig/sessions`.
- Generate session IDs.
- Write `session.json`.
- Append `events.jsonl`.
- Write human-readable `transcript.md`.
- Store patch artifacts.

### Tool Registry

- Implement `defineTool`.
- Implement registry lookup.
- Generate model-facing tool schemas.
- Validate arguments with Zod.
- Normalize tool errors.

### Read Tools

- Implement workspace path resolver.
- Implement file listing.
- Implement text file reading.
- Implement line ranges.
- Implement search.
- Implement git status/diff helpers.

### Safety

- Implement risk classifier.
- Implement approval prompt.
- Implement dangerous command detection.
- Implement workspace boundary enforcement.
- Implement dirty file warnings.

### Editing

- Implement patch tool.
- Validate patch paths.
- Check patch applies cleanly.
- Apply patch.
- Store patch copy in session.
- Add changed-file tracking.

### Shell Execution

- Implement command runner.
- Add timeout handling.
- Capture stdout/stderr.
- Truncate large output.
- Classify command risk.
- Ask approval.
- Return exit code and output summary.

### Agent Loop

- Build initial context.
- Send model request.
- Parse tool calls.
- Execute tool calls.
- Append observations.
- Stop on final answer.
- Enforce max step count.

### CLI Commands

- `ask`
- `run`
- `review`
- `resume`
- `status`
- `log`
- `config`

### Tests

- Unit test path resolver.
- Unit test command classifier.
- Unit test event log writer.
- Unit test tool registry.
- Unit test patch validation.
- Integration test read-only ask flow with mock model.
- Integration test patch flow with mock model.
- Integration test shell verification flow with mock model.

## Suggested First Vibecoding Prompt

Use this prompt to start implementation:

```text
Build the initial TypeScript CLI skeleton for RIG, a terminal-native AI harness for autonomous agents.

Implement:
- package.json with a bin entry named rig
- TypeScript setup
- src/cli/index.ts using commander
- commands: ask, run, review, status, resume
- a basic SessionManager that creates .rig/sessions/<session-id>
- an append-only JSONL event logger
- a ToolRegistry abstraction using zod schemas
- read-only tools: list_files, read_file, search_text, git_status
- a mock model client so the CLI can run without an API key
- vitest tests for SessionManager and ToolRegistry

Do not implement file editing yet. Keep the architecture ready for patch and shell tools in the next phase.
```

## First Milestone Acceptance Criteria

After the first coding session, this should work:

```bash
npm install
npm test
npm run build
npx rig --help
npx rig ask "what files are in this project?"
```

Expected behavior:

- Help output displays commands.
- `ask` creates a session.
- Session events are written.
- Read-only tools are registered.
- Mock model produces a deterministic response.
- Tests pass.

## Future Enhancements

### Multi-Agent Mode

Allow specialized agents:

- Planner.
- Researcher.
- Implementer.
- Reviewer.
- Tester.

Not needed for MVP.

### Project Index

Build a lightweight codebase index for faster context retrieval.

Possible features:

- File summaries.
- Symbol extraction.
- Dependency graph.
- Search ranking.

### Policy Profiles

Allow different operating modes:

```bash
rig run "fix tests" --policy cautious
rig run "format project" --policy autonomous
```

Profiles:

- `cautious`
- `balanced`
- `autonomous`

### Remote Sandboxes

Run risky commands in disposable environments.

### Plugin System

Expose a stable interface for custom tools:

```ts
export default defineRigPlugin({
  name: "database-tools",
  tools: [queryDatabaseTool],
});
```

### Rich Terminal UI

Add a live task view with:

- Current plan.
- Tool activity.
- Approval queue.
- Token usage.
- Changed files.

## Open Product Questions

- Should RIG default to read-only mode on first run?
- Should patch approval show full diffs or file summaries by default?
- Should shell command approval be per command, per category, or per session?
- Should `.rig` be committed or ignored by default?
- Should RIG support project-specific instructions in `.rig/instructions.md` or use existing files like `AGENTS.md`?
- Should model configuration be global, local, or both?
- Should `rig run` automatically run tests when a likely test command exists?

## Recommended MVP Defaults

- First run starts in cautious mode.
- Reads are allowed.
- Writes require approval.
- Shell commands require approval.
- Dangerous commands are blocked.
- Sessions are saved under `.rig/sessions`.
- `.rig/sessions` should be gitignored by default.
- `.rig/instructions.md` may be committed if the project wants shared agent guidance.
- Use TypeScript first.
- Use OpenAI as the first real model provider.
- Use a mock model for tests.

## Summary

RIG should be built as a controlled execution harness, not a chat wrapper. The first version should focus on a small but complete loop: inspect, plan, edit, verify, and summarize.

If that loop is solid, everything else can grow around it.

