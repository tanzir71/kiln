import { app, ipcMain, Menu, nativeImage, Tray } from 'electron';

let tray: Tray | undefined;
export function registerTrayBridge(): void {
  ipcMain.handle('kiln:tray:set', (_event, input: { title?: string; tooltip?: string; items?: Array<{ id: string; label: string }> }) => {
    tray ??= new Tray(nativeImage.createEmpty());
    tray.setTitle(input.title ?? '');
    tray.setToolTip(input.tooltip ?? app.name);
    tray.setContextMenu(Menu.buildFromTemplate([
      ...(input.items ?? []).map((item) => ({ label: item.label, click: () => tray?.emit('kiln-item', item.id) })),
      { type: 'separator' }, { label: 'Quit', click: () => app.quit() },
    ]));
  });
  ipcMain.handle('kiln:tray:clear', () => { tray?.destroy(); tray = undefined; });
}
