import { ipcMain, Notification } from 'electron';

export function registerNotificationBridge(): void {
  ipcMain.handle('kiln:notify:show', (_event, options: { title: string; body: string }) => {
    if (Notification.isSupported()) new Notification(options).show();
  });
}
