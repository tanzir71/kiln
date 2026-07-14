import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { resolve } from 'node:path';
import { KilnService } from './kiln-service';
import { registerIpc } from './ipc';

let mainWindow: BrowserWindow | undefined;
let service: KilnService | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 790,
    minWidth: 980,
    minHeight: 640,
    title: 'Kiln',
    titleBarStyle: 'hiddenInset',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#181817' : '#f4f3f0',
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && url !== current) event.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(resolve(__dirname, '../renderer/index.html'));
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    nativeTheme.themeSource = 'system';
    const resourcesRoot = app.isPackaged ? process.resourcesPath : resolve(app.getAppPath());
    service = new KilnService(resourcesRoot);
    registerIpc(service);
    service.on('chat-update', (projectId, message) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('kiln:chatUpdate', projectId, message);
    });
    service.on('project-update', (project) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('kiln:projectUpdate', project);
    });
    createWindow();
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('before-quit', () => service?.shutdown());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
