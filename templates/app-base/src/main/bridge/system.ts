import { execFile } from 'node:child_process';
import { ipcMain, nativeTheme, powerMonitor } from 'electron';

export function registerSystemBridge(): void {
  ipcMain.handle('kiln:system:darkMode', () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle('kiln:system:onBattery', () => powerMonitor.isOnBatteryPower());
  ipcMain.handle('kiln:system:appleScript', async (_event, source: string) => await new Promise<string>((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', source], (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }));
}
