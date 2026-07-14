import { ipcMain } from 'electron';
import Store from 'electron-store';

const store = new Store<Record<string, unknown>>();
export function registerStoreBridge(): void {
  ipcMain.handle('kiln:store:get', (_event, key: string) => store.get(key));
  ipcMain.handle('kiln:store:set', (_event, key: string, value: unknown) => store.set(key, value));
  ipcMain.handle('kiln:store:delete', (_event, key: string) => store.delete(key));
}
