import { ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';

const ALLOWED = new Set(['ffmpeg', 'sips']);

export function registerShellBridge(): void {
  ipcMain.handle('kiln:shell:openExternal', (_event, url: string) => shell.openExternal(url));
  ipcMain.handle('kiln:shell:openPath', (_event, path: string) => shell.openPath(path));
  ipcMain.handle('kiln:shell:run', async (_event, command: string, args: string[]) => {
    if (!ALLOWED.has(command)) throw new Error(`Command is not allowlisted: ${command}`);
    return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, { shell: false });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  });
}
