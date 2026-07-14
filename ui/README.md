# Kiln UI (pre-built — do not rewrite)

This is the complete renderer UI for Kiln, hand-built and design-reviewed. It runs in two modes:

- **Standalone preview**: `npm install && npm run dev` → http://localhost:5180 against a built-in mock backend (yellow "MOCK BACKEND" pill visible). Use this to see every screen and flow.
- **In Electron**: when `window.kiln` exists (provided by the preload script), the mock is bypassed automatically. No UI changes needed.

## Integration contract (for Codex)

1. `src/types.ts` defines `KilnAPI`. Implement it 1:1 in the Electron preload (`contextBridge.exposeInMainWorld('kiln', …)`) backed by IPC to the main process. **The UI is the source of truth for this interface** — if reality demands a signature change, change types.ts and the UI call sites minimally, and say so in PROGRESS.md.
2. Move/mount this package as the electron-vite renderer (`src/renderer`). Keep `src/api.ts`'s mock — it must keep working for browser-only development (`isMock` guard).
3. Two behaviors are intentionally stubbed as visuals in the mock and need real backing:
   - `PreviewStage` (BuilderView) shows a placeholder frame. For Mac apps the real preview is the generated app's own window (dev server) — the stage only reflects run state. For extensions it reflects WXT's dev browser.
   - Version screenshots (`Version.screenshot`) come from the smoke-test capture.
4. Events streamed via `onChatUpdate` re-send the **whole updated agent message** (upsert by `message.id`), not deltas. Keep that contract — it makes the UI resilient to missed events.
5. Design rules if you must touch UI: system font stack, 13px base, CSS variables in `styles.css` only (no inline colors), light/dark via `prefers-color-scheme`, `-webkit-app-region: drag` titlebar with 84px traffic-light inset (`titleBarStyle: 'hiddenInset'`).

## What's covered

- Projects home: grid, type badges, ⌘N, New Project modal (name / Mac app vs Extension / engine picker with readiness).
- Builder: chat with collapsible agent steps (thinking/read/edit/command/gate + pass/fail), Plan/Build segmented toggle, ⌘↩ send, Cancel; preview pane with Run/Stop; Versions tab (revert); Files tab (tree + read-only viewer + open-in-editor); Export DMG / Export ZIPs with progress + reveal.
- Settings: four engine cards (status dot, version, BYOK key entry → Keychain, model picker, "Test engine"), default engine, projects folder, Developer ID signing + notarization toggles.
- Toasts, empty states, mock-mode indicator.
