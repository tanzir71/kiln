// LOCKED BY KILN — extend behavior through src/main/bridge/custom.ts.
import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('kiln', {
  fs: {
    openFile: (filters?: Electron.FileFilter[]) => invoke('kiln:fs:open', filters),
    saveFile: (defaultPath?: string) => invoke('kiln:fs:save', defaultPath),
    readText: (path: string) => invoke('kiln:fs:read', path),
    writeText: (path: string, value: string) => invoke('kiln:fs:write', path, value),
  },
  shell: {
    openExternal: (url: string) => invoke('kiln:shell:openExternal', url),
    openPath: (path: string) => invoke('kiln:shell:openPath', path),
    run: (command: string, args: string[]) => invoke('kiln:shell:run', command, args),
  },
  store: {
    get: (key: string) => invoke('kiln:store:get', key),
    set: (key: string, value: unknown) => invoke('kiln:store:set', key, value),
    delete: (key: string) => invoke('kiln:store:delete', key),
  },
  notify: { show: (options: { title: string; body: string }) => invoke('kiln:notify:show', options) },
  tray: {
    set: (input: { title?: string; tooltip?: string; items?: Array<{ id: string; label: string }> }) => invoke('kiln:tray:set', input),
    clear: () => invoke('kiln:tray:clear'),
  },
  shortcuts: {
    register: (accelerator: string) => invoke('kiln:shortcuts:register', accelerator),
    unregister: (accelerator: string) => invoke('kiln:shortcuts:unregister', accelerator),
  },
  clipboard: {
    readText: () => invoke('kiln:clipboard:readText'),
    writeText: (value: string) => invoke('kiln:clipboard:writeText', value),
  },
  system: {
    darkMode: () => invoke('kiln:system:darkMode'),
    onBattery: () => invoke('kiln:system:onBattery'),
    runAppleScript: (source: string) => invoke('kiln:system:appleScript', source),
  },
  custom: { invoke: (operation: string, payload?: unknown) => invoke('kiln:custom', operation, payload) },
});
