# Kiln — an open Glaze.app alternative

**Handoff spec for an autonomous coding agent (Codex).** Work through the milestones in order. Each milestone has acceptance criteria — do not move on until they pass. Re-read this file at the start of every loop iteration.

---

## 1. What we're building

Kiln is a macOS desktop app that turns a plain-language prompt into real, installable software. It supports two project types:

- **Mac app** → exported as a `.dmg` (the Glaze-equivalent core).
- **Browser extension** → exported as store-ready `.zip` files (Chrome/Edge MV3 + Firefox), loadable unpacked or submittable to the Chrome Web Store / AMO.

It is a self-hosted alternative to [Glaze by Raycast](https://www.glaze.app/).

How Glaze works (from public docs/press, use as the reference model):

- User chats with an agent; the agent plans, writes code, installs deps, and launches the app live.
- Under the hood Glaze runs **Claude Code or OpenAI Codex** as the coding agent.
- Generated apps are local-first, React-based desktop apps with OS access (files, menu bar, shortcuts, notifications, background processes).
- Every build is saved as a **version** the user can revert to.
- Plan mode vs Build mode; app icon generation is built in.

Kiln replicates the core loop, minus the store/teams/credits SaaS layer:

1. **Prompt → App**: chat UI drives a coding agent that scaffolds, edits, and hot-reloads the generated project in dev mode (Electron+React for Mac apps, WXT+React for extensions).
2. **Iterate**: follow-up prompts modify the app; every agent run is a git commit (= version history, revert supported).
3. **Package**: one click produces an ad-hoc-signed `.dmg` (Mac apps) or store-ready `.zip`s (extensions).
4. **Auth**: user chooses per-project engine — Claude (subscription via Claude Code CLI, or BYOK Anthropic API key) or Codex (ChatGPT subscription via Codex CLI, or BYOK OpenAI API key).

Project type is chosen at creation (or inferred from the prompt — "an extension that…" → extension) and fixed for the project's lifetime. Everything else — engines, harness, validation gate, versions, icon pipeline — is shared across both types.

### Non-goals (v1)

No app store, no accounts/server, no Windows/Linux, no team sharing, no credit metering, no MCP/OAuth integrations UI (leave extension points).

---

## 2. Architecture overview

Two Electron apps are involved — don't conflate them:

- **Kiln itself** (the builder): Electron 33+ / React 18+ / TypeScript / Vite (`electron-vite`). Chat UI + project manager + packager.
- **Generated apps**: each project is a standalone Electron+React workspace created from a template, living in `~/Kiln/projects/<slug>/`. Each has its own `package.json`, git repo, and can be built to a DMG independently.

```
kiln/
├── package.json
├── electron.vite.config.ts
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.ts
│   │   ├── agent/            # engine drivers (claude-code, codex, api-byok)
│   │   ├── projects/         # scaffold, git versioning, registry
│   │   ├── packager/         # build pipeline → dmg
│   │   ├── icons/            # icon pipeline
│   │   └── secrets/          # keychain-backed key storage
│   ├── preload/              # implements KilnAPI from ui/src/types.ts
│   └── renderer/             # ← mount the pre-built ui/ package here (see §9)
├── templates/
│   ├── app-base/             # Mac app template (see §4)
│   └── ext-base/             # browser extension template (see §4b)
├── harness/                  # prompts + rules injected into every agent run (see §5)
│   ├── AGENTS.md             # master system rules for generated apps
│   ├── capabilities/         # per-capability recipe docs (see §6)
│   └── icons/                # icon pipeline scripts + licensed icon sets
└── e2e/
```

**Process model**: agent runs happen in a child process spawned by Kiln's main process, streaming JSON events to the renderer over IPC. The generated app's dev server (`electron-vite dev`) runs as another child process; kill/restart it after each agent run completes.

---

## 3. Agent engines & auth (BYOK + subscriptions)

**Compliance constraint (important, verified July 2026):** Anthropic prohibits using Claude subscription OAuth tokens outside Claude Code/claude.ai. So "use my Claude subscription" MUST be implemented by shelling out to the official **Claude Code CLI** (`claude`), which manages its own login — never by extracting or reusing OAuth tokens, and never via `CLAUDE_CODE_OAUTH_TOKEN` tricks. Same pattern for OpenAI: ChatGPT-plan usage goes through the official **Codex CLI** (`codex login` ChatGPT sign-in). This is exactly what Glaze does. BYOK API keys are the alternative path on both sides.

Implement a common driver interface:

```ts
interface AgentEngine {
  id: 'claude-sub' | 'claude-byok' | 'codex-sub' | 'codex-byok';
  checkAvailable(): Promise<{ ok: boolean; reason?: string; version?: string }>;
  run(opts: {
    cwd: string;                 // generated app workspace
    prompt: string;
    mode: 'plan' | 'build';
    sessionId?: string;          // resume prior conversation for iteration
    onEvent: (e: AgentEvent) => void;  // streamed: text, tool_use, file_edit, done, error
    abortSignal: AbortSignal;
  }): Promise<{ sessionId: string; exitCode: number }>;
}
```

### 3.1 Claude via subscription — Claude Code CLI

- Detect binary: `claude --version` (also check `~/.claude/local/claude`). If missing, Settings shows install instructions (`npm install -g @anthropic-ai/claude-code`) and a "Sign in" button that opens Terminal running `claude` for first-time login.
- Run headless: `claude -p "<prompt>" --output-format stream-json --verbose --permission-mode acceptEdits --add-dir <cwd>` with `cwd` set to the project. Parse the stream-json events (init/assistant/tool_use/result).
- Iteration: capture `session_id` from the result event; resume with `--resume <session_id>`.
- Plan mode: `--permission-mode plan`.
- Restrict tools: `--allowedTools "Read,Write,Edit,Bash(npm *),Bash(node *),Bash(git *),Glob,Grep"` — the agent must not need network beyond npm.
- **Do not hardcode flags blindly** — at implementation time run `claude --help` and adapt; CLI flags drift.

### 3.2 Claude via BYOK — Agent SDK

- Use `@anthropic-ai/claude-agent-sdk` (TypeScript) with `ANTHROPIC_API_KEY` set in the child env. Same event mapping as 3.1 (the SDK wraps the same CLI).
- Key stored in macOS Keychain (`keytar` or `safeStorage`), never plaintext on disk, never logged.

### 3.3 Codex via ChatGPT subscription — Codex CLI

- Detect: `codex --version`; login state via `codex login status`. If logged out, deep-link the user to run `codex login` (browser OAuth, ChatGPT Plus/Pro/Business).
- Run headless: `codex exec --json -C <cwd> --sandbox workspace-write "<prompt>"`. Parse JSONL events.
- Iteration: `codex exec resume <session_id>` (or `--last`). Verify exact resume syntax with `codex exec --help` at implementation time.
- Plan mode: prepend a harness instruction ("produce a plan, make no edits") since Codex has no native plan flag.

### 3.4 Codex via BYOK

- Same as 3.3 but authenticate with `OPENAI_API_KEY` in child env (usage-based billing). Keychain storage as in 3.2.

### 3.5 Settings UI

Per-engine status card (installed? logged in? key present?), model picker where supported (`--model` / `-m`), default engine, per-project override. A "Test engine" button runs a trivial prompt in a temp dir and reports round-trip success.

---

## 4. The generated-app template (`templates/app-base`)

Every project starts as a copy of this template. It must be boring, pinned, and known-good — the agent edits app code, **never** build config. This is the single biggest reliability lever: the agent can't break packaging if packaging isn't its job.

Stack: **Electron (pinned) + React 18 + TypeScript + Vite (electron-vite) + Tailwind CSS + electron-builder**.

```
app-base/
├── package.json              # pinned deps; scripts: dev, typecheck, lint, build, dist
├── electron.vite.config.ts   # LOCKED — agent must not edit
├── electron-builder.yml      # LOCKED — dmg target, arm64, ad-hoc identity "-"
├── tsconfig.json
├── AGENTS.md                 # symlinked/copied from harness at run time
├── src/
│   ├── main/
│   │   ├── index.ts          # window mgmt, single-instance, deep links
│   │   └── bridge/           # pre-built, typed IPC modules the agent composes:
│   │       ├── fs.ts         #   scoped file read/write/watch + native open/save dialogs
│   │       ├── shell.ts      #   run whitelisted binaries (ffmpeg etc.), open URLs/paths
│   │       ├── store.ts      #   electron-store persistence
│   │       ├── notify.ts     #   Notification API wrapper
│   │       ├── tray.ts       #   menu bar / tray helper (menubar pattern)
│   │       ├── shortcuts.ts  #   globalShortcut registration
│   │       ├── clipboard.ts
│   │       └── system.ts     #   osascript/AppleScript runner, dark-mode, power info
│   ├── preload/index.ts      # exposes bridge as window.kiln.* (contextIsolation ON)
│   └── renderer/             # React app — this is where the agent works 95% of the time
│       ├── App.tsx
│       └── ui/               # small component kit: Button, Input, List, Dialog, Toast
├── resources/
│   └── icon.icns             # replaced by icon pipeline
└── build/entitlements.mac.plist
```

Rules baked into the template:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for renderer. All OS access flows through the typed preload bridge. The agent extends the bridge only via documented extension points (`src/main/bridge/custom.ts`).
- `package.json` dependency versions **pinned exactly**. The agent may add deps only from the allowlist (§6) via `npm install --save-exact`.
- Scripts: `npm run dev` (hot reload), `npm run typecheck`, `npm run lint`, `npm run dist` (electron-builder → dmg). `dist` is invoked by Kiln's packager, not the agent.
- electron-builder config: `mac.target: dmg` + `zip`, `arch: arm64`, `identity: "-"` (ad-hoc), `hardenedRuntime: false` (required for ad-hoc; flip to `true` + entitlements `allow-jit`, `allow-unsigned-executable-memory` only on the Developer ID path), `npmRebuild: true`, asarUnpack for native modules (`ffmpeg-static`, `sharp`, `better-sqlite3`).
- Template ships **pre-installed** `node_modules` cached at `~/Kiln/cache/app-base-node_modules/` (copied/hardlinked into new projects) so first build doesn't wait on npm.

---

## 4b. The extension template (`templates/ext-base`)

Same philosophy as §4: locked config, pinned deps, the agent writes feature code only.

Stack: **WXT** (actively maintained extension framework, MV3-first, HMR dev mode, first-class zip output) + **React 18 + TypeScript + Tailwind**, module `@wxt-dev/module-react`. Verify current WXT APIs against https://wxt.dev at implementation time.

```
ext-base/
├── package.json              # pinned; scripts: dev, dev:firefox, typecheck, lint, zip
├── wxt.config.ts             # LOCKED — targets chrome-mv3 + firefox-mv2/mv3, zip settings
├── tsconfig.json
├── AGENTS.md                 # injected from harness (extension variant)
├── entrypoints/              # agent's playground — WXT convention-based:
│   ├── popup/                # React popup (default UI surface)
│   ├── options/              # React options page (scaffolded, optional)
│   ├── background.ts         # MV3 service worker
│   └── content.ts            # content script (matches configured per-app)
├── components/ui/            # same small component kit as app-base
├── utils/
│   ├── storage.ts            # typed wrapper over browser.storage (WXT storage API)
│   └── messaging.ts          # typed bg↔content↔popup messaging helper
└── public/icon/              # 16/32/48/96/128 PNGs from icon pipeline
```

Rules baked in:

- Cross-browser from day one: use the `browser.*` namespace (WXT ships webextension-polyfill behavior); never `chrome.*` directly.
- **Manifest is generated by WXT from `wxt.config.ts` + entrypoint metadata.** The agent requests permissions by editing a single declared `permissions`/`host_permissions` block in the manifest section of `wxt.config.ts` — the only exception to the locked-file rule, enforced by the gate as "this block only," and the gate flags overly broad grants (`<all_urls>`, `tabs`, `scripting`) for user confirmation in chat.
- **MV3 constraints taught in AGENTS.md**: no remote code (bundle everything), service worker is ephemeral (no in-memory state — use `browser.storage`/alarms), no `eval`, CSP-safe only. These are the top rejection reasons in Chrome Web Store review.
- Dev loop: `npm run dev` opens a Chromium instance with the extension auto-loaded + HMR (WXT does this natively). `npm run dev:firefox` for Firefox spot checks.

### Extension capability recipes (`harness/capabilities/ext-*.md`)

| Capability | Mechanism | Notes |
|---|---|---|
| Page modification / overlays | content script + shadow DOM UI (WXT `createShadowRootUi`) | isolates styles from host page |
| Save/read user data | `browser.storage.local` / `sync` via utils/storage.ts | sync has quota limits — recipe covers them |
| Context menus | `browser.contextMenus` | background entrypoint |
| Keyboard shortcuts | `commands` in manifest block | |
| Periodic jobs | `browser.alarms` | never `setInterval` in SW |
| Network interception | `declarativeNetRequest` | MV3 replacement for blocking webRequest |
| Screenshots of tabs | `browser.tabs.captureVisibleTab` | needs `activeTab` |
| Side panel | `browser.sidePanel` (Chrome) | graceful no-op on Firefox |
| Clipboard, downloads, notifications | standard APIs | one recipe each |
| External APIs / AI calls | fetch from background SW; keys in `storage.local` via options page | warn: keys in extension storage are user-visible |

## 5. The harness (what makes generation "flawless")

The harness is everything wrapped around the raw agent to keep output on rails. Components:

**5.1 AGENTS.md / CLAUDE.md injected into every project.** One file *per project type* (app variant, extension variant), written once, containing: the template's architecture map; the bridge API reference with copy-paste examples; hard rules (never touch locked files, never `npm install` outside allowlist, never use `remote`/`nodeIntegration`, always keep `npm run typecheck && npm run lint` green); UI conventions (Tailwind, dark-mode aware via `prefers-color-scheme`, native macOS feel: vibrancy, SF Pro via `-apple-system`, traffic-light inset titlebar `titleBarStyle: 'hiddenInset'`); and pointers to capability recipes ("video/audio → read harness/capabilities/media.md first").

**5.2 Prompt composer.** Kiln never sends the raw user prompt. It sends: user prompt + selected capability recipes (keyword-matched: "video" → media.md, "menu bar" → tray.md, "database"/"track" → data.md, etc.) + current app state summary (file tree + last run's error log if any) + the standing instruction: *"Finish by running `npm run typecheck` and `npm run lint` and fixing all errors."*

**5.3 Validation gate (runs after every agent turn, before showing "done"):**

1. `git add -A && git commit` (checkpoint even if broken — enables revert).
2. Locked-file check: `git diff` against template hashes for `electron.vite.config.ts`, `electron-builder.yml`, `preload/index.ts` core — if modified, auto-revert those files and warn.
3. Dependency audit: any new dep not on the allowlist → remove + re-run agent with the violation message.
4. `npm run typecheck` → on failure, feed errors back to the agent (max 3 repair rounds).
5. `npm run lint --fix`.
6. Smoke test — per project type:
   - *Mac app*: launch `electron-vite dev` headless-ish, wait for `did-finish-load`, capture `webContents.capturePage()` screenshot + console errors.
   - *Extension*: `npm run build` (WXT), assert manifest validity (parse `.output/chrome-mv3/manifest.json`; required keys, no unknown permissions), then launch Playwright Chromium with `--load-extension` on the build output, assert the service worker registers without errors and the popup page renders (screenshot + console). Failures → repair round, same as apps.
7. Tag the commit `v<N>` and surface it in Version History UI.

**5.4 Repair loop budget.** Max 3 automatic repair rounds per user prompt; after that, show errors honestly in chat with a "try again" affordance. Never silently loop forever.

**5.5 Version history.** Each user prompt = one squashed commit. UI lists versions with screenshot thumbnails; "Revert" = `git revert`/`reset` + reinstall if `package.json` changed.

---

## 6. Capability library (curated, pre-vetted)

`harness/capabilities/*.md` — one recipe per capability: which package (exact version), install line, minimal working example wired through the bridge, common pitfalls. The dependency **allowlist** is generated from these files.

| Capability | Package(s) | Notes |
|---|---|---|
| Video/audio processing | `ffmpeg-static` + `fluent-ffmpeg` | ships ffmpeg binary; asarUnpack; GPL — note in about box |
| Audio transcription | `whisper.cpp` via `smart-whisper` or `nodejs-whisper` | offline STT; model download on demand |
| Image processing | `sharp` | prebuilt arm64 binaries; asarUnpack |
| Screenshots/recording | Electron `desktopCapturer` + bridge | needs Screen Recording permission (see permissions.md) |
| Local database | `better-sqlite3` | sync API, rebuild via electron-builder |
| Simple persistence | `electron-store` | default choice; JSON, schema support |
| Spreadsheets | `xlsx` (SheetJS CE) | read/write Excel |
| PDFs | `pdf-lib` (create/edit), `pdfjs-dist` (render) | |
| OCR | `tesseract.js` | WASM, no native build |
| Charts | `recharts` | pre-installed in template |
| HTTP | native `fetch` | no axios |
| Menu bar apps | `menubar` | + template tray bridge |
| Global hotkeys | Electron `globalShortcut` | via bridge |
| macOS permissions | `node-mac-permissions` | query/prompt TCC: files, screen, mic, camera, accessibility |
| AppleScript/system | `run-applescript` / `osascript` via bridge | control other apps, get frontmost window, etc. |
| Markdown | `marked` + `dompurify` | sanitize always |
| Drag & drop files | Electron native + recipe | common request; document `webUtils.getPathForFile` |
| Dates | `date-fns` | pre-installed |
| Icons (UI) | `lucide-react` | pre-installed; ISC license |

Recipe docs also cover the **permission dance**: Info.plist usage strings are pre-declared in the template's electron-builder config (`NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, etc. — all of them, harmless if unused since ad-hoc builds skip App Store review), and `node-mac-permissions` examples show how to request at runtime.

---

## 7. Icon pipeline (open-source icons → .icns)

Zero-dependency on macOS: `sips` + `iconutil` are built in.

1. **Glyph selection**: bundle SVG sets (permissive licenses): **Lucide** (ISC), **Phosphor** (MIT), **Iconoir** (MIT), **Tabler** (MIT). Build a small keyword→icon index (name + tags from each set's metadata). The agent (or a cheap heuristic) picks a glyph from the app description — e.g. "pomodoro timer" → `timer`.
2. **Composition** (deterministic script, `harness/icons/compose.ts`, run with `sharp`): 1024×1024 canvas → macOS squircle mask (use the standard Apple app-icon grid; bundle the squircle path as SVG) → background = 2-stop gradient from a curated palette of ~12 pairs (hash the app name to pick one deterministically, allow user override) → white glyph centered at ~55% size with subtle drop shadow → export PNG.
3. **icns**: render 16/32/64/128/256/512/1024 (+@2x) via `sharp`, assemble `icon.iconset/`, run `iconutil -c icns`. Fallback if iconutil missing: `png2icns` from `icon-gen` package.
4. Regenerate on demand ("change my icon to a blue flame") — map request → glyph search → palette pick → re-run pipeline → rebuild not required in dev (dock icon set at runtime via `app.dock.setIcon`).
5. **Extension variant**: same composition (steps 1–2, rounded-square mask instead of macOS squircle), export PNGs at 16/32/48/96/128 into `public/icon/`; WXT wires them into the manifest automatically.

---

## 8. Packaging → DMG / ZIP

`src/main/packager/` orchestrates; the agent is never involved.

### 8a. Mac apps → DMG

1. Preflight: validation gate green, icon present, `productName`/`appId` set (`com.kiln.<slug>`), version bump.
2. `npm run dist` in the project (electron-builder): arm64 dmg, ad-hoc signature (`identity: "-"`).
3. Output to `~/Kiln/dist/<AppName>-<version>.dmg`; reveal in Finder; also offer "Install to /Applications" directly.
4. **First-run reality check**: ad-hoc-signed apps trigger Gatekeeper on *other* Macs (right-click → Open, or `xattr -d com.apple.quarantine`). Kiln's UI must state this plainly next to the export button, and generate a short `README-INSTALL.txt` beside the dmg. On the building Mac itself, ad-hoc apps run fine.
5. **Optional signing path** (Settings → Distribution): if the user provides a Developer ID Application cert + Apple ID app-specific password / API key, switch electron-builder to `identity: <cert>`, `hardenedRuntime: true`, entitlements `com.apple.security.cs.allow-jit` + `allow-unsigned-executable-memory`, and notarize via `@electron/notarize` (notarytool). DMG itself stays unsigned (Gatekeeper checks the stapled .app inside — current electron-builder default behavior).

### 8b. Extensions → ZIP

1. Preflight: validation gate green, icons present, `name`/`version`/`description` set in the manifest block (Chrome Web Store requires a description; bump version on every export).
2. `npx wxt zip` → Chrome/Edge zip; `npx wxt zip -b firefox` → Firefox zip + the sources zip AMO review requires.
3. Output to `~/Kiln/dist/<ExtName>-<version>-{chrome,firefox}.zip`; reveal in Finder.
4. Ship a generated `README-INSTALL.txt`: unpacked install steps (chrome://extensions → Developer mode → Load unpacked, or drag the zip; Firefox about:debugging temporary load) plus store-submission pointers (Chrome Web Store one-time $5 dev fee, AMO free).
5. "Test in Chrome" button: unzip to temp + launch Chromium with `--load-extension` so the user can try the exact export artifact.

---

## 9. Kiln UI (renderer) — ALREADY BUILT, DO NOT REWRITE

The complete renderer lives in **`ui/`** (React + TS + Vite, no Tailwind — hand-rolled design system in `ui/src/styles.css`). It was built and design-reviewed separately. Read **`ui/README.md`** before touching anything.

Rules:

- **Do not redesign, restyle, or rebuild UI components.** Your job is the backend behind them.
- The IPC contract is **`ui/src/types.ts` (`KilnAPI`)**. Implement it exactly in the preload script (`contextBridge.exposeInMainWorld('kiln', …)`) + main-process IPC handlers. The UI already handles streaming (message upserts by id), optimistic states, empty states, errors, and mock fallback.
- Mount `ui/` as the electron-vite renderer. Keep its standalone `vite dev` mode working (mock backend, `isMock` guard) — it's the UI's test harness.
- Allowed UI edits: bug fixes, and minimal call-site adjustments if a `KilnAPI` signature must change for real-world reasons — record every such deviation in PROGRESS.md.
- Surfaces already covered: Projects home (grid, ⌘N, New Project modal with type + engine picker), Builder (chat with collapsible agent steps, Plan/Build toggle, ⌘↩, Cancel; preview pane; Versions with revert; Files tree/viewer; Export DMG/ZIPs), Settings (engine cards with BYOK keys/models/test, default engine, projects dir, signing/notarization), toasts.
- Window config expected by the UI: `titleBarStyle: 'hiddenInset'` (84px traffic-light inset is styled in), min size ~980×640, dark-mode follows system.

---

## 10. Milestones (loop order) & acceptance criteria

**M0 — Repo scaffold + UI mount.** Electron shell boots with the pre-built `ui/` package as renderer (`titleBarStyle: 'hiddenInset'`); a stub preload implements `KilnAPI` by delegating to the UI's mock logic (or minimal in-memory equivalents) so every screen renders inside Electron on day one. CI script `npm run check` = typecheck+lint+unit, and it typechecks `ui/` too. ✅ when `npm run check` passes and all three UI surfaces render in the Electron window.

**M1 — Template.** `templates/app-base` complete; manually copying it and running `npm run dev` shows a hello-world app; `npm run dist` yields a working dmg. ✅ when a human-free script (`e2e/template.test.ts`) does copy→install→typecheck→dist and asserts dmg exists + app bundle launches.

**M2 — Engine drivers.** All four engines behind `AgentEngine`; `checkAvailable` accurate; a scripted run in a temp project makes a trivial edit. ✅ when driver unit tests pass with at least one real engine end-to-end (use whichever is authenticated on this machine; mock the others).

**M3 — Project lifecycle.** Create project (template copy + git init + hardlinked node_modules), list, delete, open. ✅ when e2e creates and reopens a project.

**M4 — Chat loop + validation gate.** Prompt → agent run → gate (§5.3) → dev preview relaunch → version commit. ✅ when prompt "make a pomodoro timer with a 25/5 cycle and a menu bar countdown" produces a working app with zero manual fixes, and an intentionally-broken injected edit gets auto-repaired.

**M5 — Icon pipeline.** ✅ when 5 different app names yield 5 distinct valid `.icns` (verify with `iconutil` round-trip / `file` output) and dock icon updates live.

**M6 — DMG export.** ✅ when the M4 pomodoro app exports a dmg that mounts, installs, and launches on this machine.

**M7 — Version history + revert.** ✅ when reverting to v1 after 3 edits restores behavior and preview.

**M8 — Integration polish.** UI polish is done (§9) — this pass is about wiring completeness: every `KilnAPI` method backed by a real implementation (no stubs left), app icon for Kiln itself (dogfood the pipeline), quit/relaunch safety (kill child processes). ✅ when a fresh user can go prompt→dmg without touching a terminal (given an installed/authed engine) and no KilnAPI method throws "not implemented".

**M9 — Extension template + gate.** `templates/ext-base` complete; project type picker wired; extension validation gate (manifest check + Playwright smoke test). ✅ when prompt "an extension that highlights all prices on a page and converts them to EUR in a tooltip" produces a working extension (content script + storage-backed currency setting in popup) with zero manual fixes.

**M10 — ZIP export.** ✅ when the M9 extension exports Chrome + Firefox zips; the Chrome zip loads unpacked without manifest warnings, and "Test in Chrome" launches with it working; extension icons render at all sizes.

### Loop protocol for the coding agent building Kiln

```
while milestones remain:
  1. Read SPEC.md; pick the first milestone whose criteria are unmet.
  2. Write/adjust the failing acceptance test first (e2e/ or unit).
  3. Implement until the test passes locally.
  4. Run the full check suite (npm run check && e2e for completed milestones) — no regressions.
  5. Commit: "M<N>: <summary>". Update PROGRESS.md with status + known issues.
```

Rules for the builder agent: verify third-party CLI flags with `--help` before wiring them (claude/codex flags drift); pin every dependency; **never redesign or rewrite the `ui/` package — implement `KilnAPI` behind it** (§9); when this spec conflicts with observed reality (e.g. a flag no longer exists), prefer reality, note the deviation in PROGRESS.md, and keep the intent.

---

## 11. Risks & known sharp edges

- **CLI drift**: Claude Code / Codex flags and event schemas change often — isolate parsing in one adapter file per engine with fixture-based tests.
- **Native module rebuilds** (`better-sqlite3`, `sharp`): must match the *generated app's* Electron version; rely on electron-builder's rebuild, cache results.
- **Ad-hoc distribution friction**: apps shared to other Macs need right-click→Open; don't oversell "share with anyone" in UI copy.
- **ffmpeg licensing**: `ffmpeg-static` is GPL — fine for personal tools; auto-add attribution to generated app's about screen.
- **Anthropic/OpenAI ToS**: subscription usage only through official CLIs (§3); never proxy, extract, or share tokens.
- **Long agent runs**: stream everything, make Cancel reliable (kill process group), autosave chat transcript per project.
- **MV3 store review**: remote code, broad host permissions, and missing privacy justifications are the top Chrome Web Store rejection causes — the gate and AGENTS.md rules exist to prevent them, and the permission-confirmation step keeps grants minimal.
- **WXT/browser API drift**: pin WXT exactly; keep manifest parsing/zip invocation in one adapter module with fixture tests, same as the engine adapters.

## 12. Reference links

- Glaze product/manual: https://www.glaze.app/ · https://manual.glaze.app (capabilities, plan/build, versions — the UX north star)
- Glaze runs Claude Code/Codex under the hood: https://alternativeto.net/news/2026/7/raycast-launches-glaze-a-new-ai-tool-for-creating-custom-desktop-apps-from-prompts/
- Claude Code headless/auth: https://code.claude.com/docs/en/authentication
- Codex CLI auth + exec: https://developers.openai.com/codex/auth · https://developers.openai.com/codex/cli/reference
- electron-builder macOS/signing: https://www.electron.build/docs/mac/ · https://www.electron.build/docs/features/code-signing/code-signing-mac/
- Icon sets: lucide.dev (ISC) · phosphoricons.com (MIT) · iconoir.com (MIT) · tabler.io/icons (MIT)
- WXT framework (extension template, zip command): https://wxt.dev
- Chrome extension MV3 rules & store policies: https://developer.chrome.com/docs/extensions · https://developer.chrome.com/docs/webstore/program-policies
- Firefox/AMO submission: https://extensionworkshop.com/documentation/publish/
