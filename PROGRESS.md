# Kiln implementation progress

## Status

- M0–M10: complete. See verification below.

## Observed-reality deviations

- Codex CLI `0.144.0-alpha.4` uses `CODEX_API_KEY` for one-shot API-key authentication in `codex exec`; the July 2026 handoff says `OPENAI_API_KEY`. Kiln follows the installed CLI and current Codex manual, while accepting/storing the UI's OpenAI key as a Codex credential.
- Added one minimal `KilnAPI` method, `testExtensionExport`, and a matching Builder button because the prebuilt contract did not expose the M10 “Test in Chrome” action. No existing signature or styling was changed.
- Installed branded Google Chrome ignores automated `--load-extension` flags. Validation and “Test in Chrome” therefore use Playwright's supported Chrome-for-Testing/Chromium binary; normal WXT development remains available through Run.

## Verification

- `npm run check` and `npm audit --audit-level=moderate` pass.
- Kiln packages to `release/Kiln-0.1.0-arm64.dmg` and ZIP.
- Clean Mac template: cache/install → typecheck → build → launch/capture → DMG passes.
- Clean extension template: cache/install → typecheck → WXT build/zip → MV3 service worker + popup passes.
- Authenticated Codex CLI made a real edit in a disposable git workspace.
- Exact pomodoro prompt produced `v1`, passed the gate, launched in preview, exported a DMG, mounted, copied, and launched.
- Exact price-converter extension prompt produced `v1` and Chrome/Firefox/sources ZIPs; supported Chromium artifact loading is covered by the extension smoke test.
- Five deterministic app names produce five distinct valid ICNS files; project reopen, three-edit revert, and injected-breakage repair tests pass.
