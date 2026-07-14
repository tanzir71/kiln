import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { registerBridge } from './bridge';

let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  const smokeScreenshot = process.env.KILN_SMOKE_SCREENSHOT;
  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    show: !smokeScreenshot,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  if (smokeScreenshot) {
    mainWindow.webContents.once('did-finish-load', () => {
      void mainWindow?.webContents.capturePage().then(async (image) => {
        await writeFile(smokeScreenshot, image.toPNG());
        app.quit();
      });
    });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  void app.whenReady().then(() => {
    registerBridge();
    createWindow();
    if (process.platform === 'darwin') {
      const icon = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(process.cwd(), 'resources/icon.png');
      app.dock?.setIcon(icon);
    }
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
