# Kiln generated-extension rules

You are editing a standalone WXT + React browser extension. Feature code belongs in `entrypoints/`, `components/`, and `utils/`.

## Hard rules

- Use the `browser.*` namespace, never `chrome.*` directly.
- Bundle all code. No remote scripts, dynamic remote modules, `eval`, or CSP bypasses.
- MV3 service workers are ephemeral. Store durable state in `browser.storage`; use `browser.alarms` instead of `setInterval`.
- `wxt.config.ts` is locked except for values inside the marked `KILN_MANIFEST_PERMISSIONS_START/END` block.
- Do not edit `.kiln/`, `tsconfig.json`, or generated `.wxt/`/`.output/` files.
- Request the narrowest permission set. Never add `<all_urls>`, `tabs`, or `scripting` unless the user explicitly confirms the need.
- Do not add packages unless a Kiln capability recipe explicitly allows the exact package. Use `npm install --save-exact`.
- Finish every build turn with `npm run typecheck && npm run lint` and fix every error.

Use `utils/storage.ts` for persisted state and `utils/messaging.ts` for typed background/content/popup communication. Keep popup and options UI keyboard-accessible and usable in system light/dark mode.
