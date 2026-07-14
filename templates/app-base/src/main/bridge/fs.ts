import { dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const grants = new Set<string>();
const grant = (path: string) => grants.add(resolve(path));
const assertGranted = (path: string): string => {
  const target = resolve(path);
  if (![...grants].some((allowed) => target === allowed || target.startsWith(`${dirname(allowed)}/`))) throw new Error('File was not selected by the user');
  return target;
};

export function registerFileBridge(): void {
  ipcMain.handle('kiln:fs:open', async (_event, filters) => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters });
    const path = result.filePaths[0];
    if (path) grant(path);
    return path;
  });
  ipcMain.handle('kiln:fs:save', async (_event, defaultPath) => {
    const result = await dialog.showSaveDialog({ defaultPath });
    if (result.filePath) grant(result.filePath);
    return result.filePath;
  });
  ipcMain.handle('kiln:fs:read', (_event, path) => readFile(assertGranted(path), 'utf8'));
  ipcMain.handle('kiln:fs:write', (_event, path, value) => writeFile(assertGranted(path), value, 'utf8'));
}
