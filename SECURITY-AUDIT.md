# RIG — Security & Documentation Audit

> **Repository**: `AyushNimbhare/rig` (public)
> **Scope**: Working tree, tracked files, full git history, packaging surface
> **Audited**: September 13, 2026
> **Auditor**: RIG GitHub & Documentation Manager

---

## 1. Executive Summary

**No credential has ever been leaked to the public repository.** The live OpenRouter API key
present on this machine lives only in `.rig/provider.json`, which is git-ignored and was
confirmed to be absent from every commit and every git object.

One **low-severity hygiene issue** was found and fixed: a per-machine runtime file,
`.rig/model.json`, had been committed and was publicly visible. It contained no secret (only a
model identifier and a timestamp), but local state does not belong in a public repo. It has
been untracked and the root cause in the onboarding logic has been closed.

Documentation was also found to be out of date in several places and has been corrected.

---

## 2. Findings

| # | Severity | Status | Finding |
|---|---|---|---|
| 1 | **Low** | ✅ Fixed | Local runtime state `.rig/model.json` was tracked and publicly visible since commit `5581e94`. No credential content. |
| 2 | **Info / no leak** | ✅ Verified | A live OpenRouter API key exists on disk in `.rig/provider.json` (mode `0600`). Verified **never committed** — no public exposure. |
| 3 | **Low** | ✅ Fixed | `.gitignore` gap: onboarding ignored `sessions/`, `cache/`, `provider.json` but not `model.json` / `config.json` — root cause of finding #1. |
| 4 | **Info** | ℹ️ Noted | `.rig/sessions/` contains verbatim user prompts (some off-topic/personal). Correctly git-ignored and not published. |
| 5 | **Info** | ℹ️ Noted | `.claude/settings.local.json` is untracked; contains only a Bash permissions allowlist. No secrets. |
| 6 | **Info** | ✅ Verified | No `.env` files, private keys, or hardcoded credentials in tracked source. Only placeholders (`sk-...`) and test fixtures (`"test-key"`). |
| 7 | **Info** | ✅ Verified | npm `files` whitelist is `["dist", "README.md", "LICENSE"]`, so `.rig/` is never packaged on publish. |

---

## 3. Detail

### 3.1 Credential scan (clean)

The only real secret on this machine is a live OpenRouter API key (format `sk-or-v1-…`,
redacted here) stored in `.rig/provider.json`. It is:

- **git-ignored** — `git check-ignore` confirms `.rig/provider.json` is ignored.
- **never committed** — `git log --all -- .rig/provider.json` is empty.
- **absent from every git object** — a full `git rev-list --all --objects` blob scan for the
  key value returned zero matches, and `git log --all -p` shows no `sk-or-v1-` / long `sk-`
  string anywhere in history.
- **file-permission restricted** — written with mode `0600` (`saveProviderConfig`).

No GitHub secret-scanning alert is warranted, because nothing secret was ever pushed.

### 3.2 Local state exposed in the public repo (fixed)

`.rig/model.json` was added in commit `5581e94` ("Update codebase with recent changes",
author `psb-001 <psb-001@github.com>`) and has been publicly visible since. Its contents:

```json
{ "model": "thinkingmachines/inkling-small:free", "updatedAt": "2026-09-01T18:55:35.034Z" }
```

No credential — but it is per-machine state that should never be committed, and it leaks the
maintainer's model preference. **Remediation applied:**

- Untracked with `git rm --cached .rig/model.json` (the local file is preserved on disk).
- Added `.rig/model.json` and `.rig/config.json` to `.gitignore`.
- Extended `setupWorkspace()` in `src/config/workspace-setup.ts` so newly initialized
  workspaces automatically ignore these paths too — closing the root cause.

### 3.3 Session logs (privacy note)

`.rig/sessions/` records every prompt and response verbatim as `events.jsonl` / `session.json`.
This directory is git-ignored and was never published, so there is no repo leak. Because the
logs contain raw prompt history, keep them ignored and consider pruning old sessions.

---

## 4. Documentation accuracy

The following documentation was out of date relative to the code and has been corrected:

| Doc | Issue | Fix |
|---|---|---|
| `README.md` | Provider list omitted **Anthropic** (supported in `provider-setup.ts`). | Added Anthropic to Features + Supported providers. |
| `README.md` | `/model` docs claimed RIG "shows offline fallback presets" when discovery fails — the code now deliberately has **no hard-coded fallback**. | Rewrote to describe the empty picker + no-fallback behavior. |
| `README.md` | Exit-code table listed two separate `1` rows. | Merged into a single accurate row. |
| `PROGRESS.md` | Top bar example showed `rig v0.1.0`; package version is `0.1.1` and resolved dynamically. | Corrected to `v0.1.1` with a note that it is resolved from `package.json`. |
| `PROGRESS.md` | Model Client section omitted Anthropic. | Added Anthropic. |
| `PROGRESS.md` | "Recently Completed Work" stopped at item 9. | Added items 10 (security hygiene) and 11 (documentation refresh). |

Verified accurate and left unchanged: package name/version (`rig-agent-harness` `0.1.1`), the
**59 tests across 14 suites** metric, the file-structure listing, and the CLI command surface.

---

## 5. Verification performed

| Check | Method | Result |
|---|---|---|
| Secret in working tree | Pattern scan for `sk-*`, `AIza*`, `ghp_*`, `AKIA*`, PEM keys, `key=value` secrets | ✅ Clean |
| Secret in git history | `git log --all -p` + full blob scan for the key value | ✅ Clean |
| Sensitive filenames in history | `git rev-list --all --objects` name filter | ✅ Clean |
| `.rig/provider.json` history | `git log --all -- .rig/provider.json` | ✅ Never tracked |
| Test count claim | Static count of `it(` blocks | ✅ 59 / 14 files |
| Typecheck / test run | `tsc --noEmit`, `vitest run` | ⚠️ Not executable in this environment (sandbox denied) — verify locally |

---

## 6. Recommendations

1. **Commit the hygiene fix.** Stage and commit the `.gitignore` change, the untrack of
   `.rig/model.json`, and the `workspace-setup.ts` update (already staged in the working tree).
2. **Rotate the OpenRouter key as defense in depth.** It was never pushed, so this is
   precautionary — do it only if the machine, backups, or the file may have been shared.
3. **Add a pre-commit secret scanner** (e.g. `gitleaks`) and enable GitHub secret scanning +
   push protection on the repository.
4. **Optionally narrow `.gitignore`** to ignore all of `.rig/` except the intentionally shared
   `instructions.md` (`.rig/*` + `!.rig/instructions.md`).

---

_No part of the live credential is reproduced in this document._
