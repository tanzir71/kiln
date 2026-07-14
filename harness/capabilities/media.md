# Video and audio processing

Allowed exact packages: `ffmpeg-static`, `fluent-ffmpeg`. Run them from Electron main through `src/main/bridge/custom.ts`; never expose arbitrary command execution to the renderer. The ffmpeg binary must remain unpacked from ASAR. Add GPL attribution in the app's About surface when distributing `ffmpeg-static`.
