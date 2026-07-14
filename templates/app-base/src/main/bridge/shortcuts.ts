import { globalShortcut, ipcMain } from 'electron';

export function registerShortcutBridge(): void {
  ipcMain.handle('kiln:shortcuts:register', (_event, accelerator: string) => globalShortcut.register(accelerator, () => undefined));
  ipcMain.handle('kiln:shortcuts:unregister', (_event, accelerator: string) => globalShortcut.unregister(accelerator));
}
