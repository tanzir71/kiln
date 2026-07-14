/// <reference types="vite/client" />
interface Window {
  kiln: {
    fs: { openFile(filters?: Electron.FileFilter[]): Promise<string | undefined>; saveFile(defaultPath?: string): Promise<string | undefined>; readText(path: string): Promise<string>; writeText(path: string, value: string): Promise<void> };
    shell: { openExternal(url: string): Promise<void>; openPath(path: string): Promise<string>; run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> };
    store: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> };
    notify: { show(options: { title: string; body: string }): Promise<void> };
    clipboard: { readText(): Promise<string>; writeText(value: string): Promise<void> };
    system: { darkMode(): Promise<boolean>; onBattery(): Promise<boolean>; runAppleScript(source: string): Promise<string> };
    custom: { invoke<T>(operation: string, payload?: unknown): Promise<T> };
  };
}
