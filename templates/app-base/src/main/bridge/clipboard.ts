import { clipboard, ipcMain } from 'electron';

export function registerClipboardBridge(): void {
  ipcMain.handle('kiln:clipboard:readText', () => clipboard.readText());
  ipcMain.handle('kiln:clipboard:writeText', (_event, value: string) => clipboard.writeText(value));
}
