# Offline transcription

Allowed package: `nodejs-whisper`. Download models only after an explicit user action, store them under Electron `userData`, show download progress, and run transcription in the main process so the renderer stays responsive.
