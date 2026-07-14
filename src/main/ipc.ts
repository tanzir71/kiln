import { ipcMain } from 'electron';
import type { KilnService } from './kiln-service';

export function registerIpc(service: KilnService): void {
  const handle = (channel: string, listener: (...args: any[]) => any) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_event, ...args) => listener(...args));
  };

  handle('kiln:listProjects', () => service.listProjects());
  handle('kiln:createProject', (input) => service.createProject(input));
  handle('kiln:deleteProject', (id) => service.deleteProject(id));
  handle('kiln:getChat', (id) => service.getChat(id));
  handle('kiln:sendPrompt', (id, prompt, mode) => service.sendPrompt(id, prompt, mode));
  handle('kiln:cancelRun', (id) => service.cancelRun(id));
  handle('kiln:runApp', (id) => service.runApp(id));
  handle('kiln:stopApp', (id) => service.stopApp(id));
  handle('kiln:listVersions', (id) => service.listVersions(id));
  handle('kiln:revertTo', (id, tag) => service.revertTo(id, tag));
  handle('kiln:listFiles', (id) => service.listFiles(id));
  handle('kiln:readFile', (id, path) => service.readFile(id, path));
  handle('kiln:openInEditor', (id, path) => service.openInEditor(id, path));
  handle('kiln:exportProject', (id) => service.exportProject(id));
  handle('kiln:testExtensionExport', (id) => service.testExtensionExport(id));
  handle('kiln:revealPath', (path) => service.revealPath(path));
  handle('kiln:getEngines', () => service.getEngines());
  handle('kiln:setApiKey', (engine, key) => service.setApiKey(engine, key));
  handle('kiln:clearApiKey', (engine) => service.clearApiKey(engine));
  handle('kiln:selectModel', (engine, model) => service.selectModel(engine, model));
  handle('kiln:testEngine', (engine) => service.testEngine(engine));
  handle('kiln:getSettings', () => service.getSettings());
  handle('kiln:updateSettings', (patch) => service.updateSettings(patch));
}
