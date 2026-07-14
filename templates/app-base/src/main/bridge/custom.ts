import { ipcMain } from 'electron';

// Generated-app agents may extend this switch with narrow, typed operations.
export function registerCustomBridge(): void {
  ipcMain.handle('kiln:custom', async (_event, operation: string, _payload: unknown) => {
    throw new Error(`Unknown custom bridge operation: ${operation}`);
  });
}
