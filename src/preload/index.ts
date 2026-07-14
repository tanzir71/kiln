import { contextBridge, ipcRenderer } from 'electron';
import type { ChatMessage, KilnAPI, Project } from '../../ui/src/types';

const invoke = <T>(method: string, ...args: unknown[]) => ipcRenderer.invoke(`kiln:${method}`, ...args) as Promise<T>;

const api: KilnAPI = {
  listProjects: () => invoke('listProjects'),
  createProject: (input) => invoke('createProject', input),
  deleteProject: (id) => invoke('deleteProject', id),
  getChat: (id) => invoke('getChat', id),
  sendPrompt: (id, prompt, mode) => invoke('sendPrompt', id, prompt, mode),
  cancelRun: (id) => invoke('cancelRun', id),
  onChatUpdate(cb) {
    const listener = (_event: Electron.IpcRendererEvent, projectId: string, message: ChatMessage) => cb(projectId, message);
    ipcRenderer.on('kiln:chatUpdate', listener);
    return () => ipcRenderer.removeListener('kiln:chatUpdate', listener);
  },
  onProjectUpdate(cb) {
    const listener = (_event: Electron.IpcRendererEvent, project: Project) => cb(project);
    ipcRenderer.on('kiln:projectUpdate', listener);
    return () => ipcRenderer.removeListener('kiln:projectUpdate', listener);
  },
  runApp: (id) => invoke('runApp', id),
  stopApp: (id) => invoke('stopApp', id),
  listVersions: (id) => invoke('listVersions', id),
  revertTo: (id, tag) => invoke('revertTo', id, tag),
  listFiles: (id) => invoke('listFiles', id),
  readFile: (id, path) => invoke('readFile', id, path),
  openInEditor: (id, path) => invoke('openInEditor', id, path),
  exportProject: (id) => invoke('exportProject', id),
  testExtensionExport: (id) => invoke('testExtensionExport', id),
  revealPath: (path) => invoke('revealPath', path),
  getEngines: () => invoke('getEngines'),
  setApiKey: (engine, key) => invoke('setApiKey', engine, key),
  clearApiKey: (engine) => invoke('clearApiKey', engine),
  selectModel: (engine, model) => invoke('selectModel', engine, model),
  testEngine: (engine) => invoke('testEngine', engine),
  getSettings: () => invoke('getSettings'),
  updateSettings: (patch) => invoke('updateSettings', patch),
};

contextBridge.exposeInMainWorld('kiln', api);
