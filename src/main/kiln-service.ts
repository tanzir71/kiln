import { EventEmitter } from 'node:events';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shell } from 'electron';
import { chromium, type BrowserContext } from 'playwright';
import type {
  AgentEvent, ChatMessage, EngineId, EngineStatus, ExportResult, FileNode, Project,
  ProjectType, RunMode, Settings, Version,
} from '../../ui/src/types';
import { event } from './agent/types';
import { composePrompt } from './agent/prompt';
import { EngineRegistry } from './agent/registry';
import { ChatStore } from './chat/store';
import { ProjectPackager } from './packager';
import { ProjectRegistry, type ProjectRecord } from './projects/registry';
import { SecretStore } from './secrets/store';
import { SettingsStore } from './settings/store';
import { safePath } from './util/files';
import { ProcessSupervisor, runCommand } from './util/process';
import { ValidationGate } from './validation/gate';

const now = () => new Date().toISOString();

export class KilnService extends EventEmitter {
  readonly settings: SettingsStore;
  readonly secrets: SecretStore;
  readonly projects: ProjectRegistry;
  readonly engines: EngineRegistry;
  readonly packager: ProjectPackager;
  readonly gate: ValidationGate;
  private readonly chats = new ChatStore();
  private readonly previews = new ProcessSupervisor();
  private readonly runs = new Map<string, AbortController>();
  private readonly extensionTests = new Map<string, { context: BrowserContext; temporary: string }>();

  constructor(private readonly resourcesRoot: string, userData?: string) {
    super();
    this.settings = new SettingsStore(userData);
    this.secrets = new SecretStore(userData);
    this.projects = new ProjectRegistry(this.settings, resourcesRoot);
    this.engines = new EngineRegistry(this.secrets, this.settings);
    this.packager = new ProjectPackager(this.settings);
    this.gate = new ValidationGate(this.projects);
  }

  async listProjects(): Promise<Project[]> { return await this.projects.list(); }

  async createProject(input: { name: string; type: ProjectType; engine: EngineId }): Promise<Project> {
    const project = await this.projects.create(input);
    this.emit('project-update', project);
    return project;
  }

  async deleteProject(id: string): Promise<void> {
    await this.cancelRun(id);
    this.previews.stop(id);
    await this.projects.delete(id);
  }

  async getChat(id: string): Promise<ChatMessage[]> {
    return await this.chats.get((await this.projects.get(id)).path);
  }

  async sendPrompt(projectId: string, prompt: string, mode: RunMode): Promise<void> {
    if (this.runs.has(projectId)) throw new Error('An agent run is already active for this project');
    const project = await this.projects.get(projectId);
    const messages = await this.chats.get(project.path);
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', mode, text: prompt, ts: now() };
    const agent: ChatMessage = { id: crypto.randomUUID(), role: 'agent', mode, text: '', events: [], inProgress: true, ts: now() };
    messages.push(user, agent);
    await this.chats.save(project.path, messages);
    this.emit('chat-update', projectId, user);
    this.emit('chat-update', projectId, agent);
    const controller = new AbortController();
    this.runs.set(projectId, controller);
    void this.executePrompt(project, prompt, mode, messages, agent, controller).catch(() => undefined);
  }

  private async executePrompt(
    project: ProjectRecord,
    prompt: string,
    mode: RunMode,
    messages: ChatMessage[],
    message: ChatMessage,
    controller: AbortController,
  ): Promise<void> {
    let sessionId = project.sessionId;
    let summary = '';
    const publish = async (incoming?: AgentEvent) => {
      if (incoming) {
        const index = message.events!.findIndex((item) => item.id === incoming.id);
        if (index < 0) message.events!.push(incoming); else message.events![index] = incoming;
        if (incoming.kind === 'text' && incoming.status === 'ok' && incoming.detail) summary = incoming.detail;
      }
      await this.chats.save(project.path, messages);
      this.emit('chat-update', project.id, { ...message, events: [...(message.events ?? [])] });
    };
    const setStatus = async (status: Project['status']) => {
      this.emit('project-update', await this.projects.setStatus(project.id, status));
    };

    try {
      await setStatus('agent-running');
      const installId = crypto.randomUUID();
      await publish(event('command', 'Preparing pinned dependencies', 'running', undefined, installId));
      await this.projects.ensureDependencies(project);
      await publish(event('command', 'Preparing pinned dependencies', 'ok', 'Dependencies ready.', installId));

      const driver = this.engines.get(project.engine);
      const availability = await driver.checkAvailable();
      if (!availability.ok) throw new Error(availability.reason ?? `${project.engine} is unavailable`);
      const apiKey = project.engine.endsWith('byok') ? await this.secrets.get(project.engine) : undefined;
      if (project.engine.endsWith('byok') && !apiKey) throw new Error('Add an API key in Settings before running this engine');
      const model = await this.settings.getModel(project.engine);
      const composed = await composePrompt(project, prompt, this.resourcesRoot);
      const baseCommit = (await this.projects.git(project.path, ['rev-parse', 'HEAD'])).stdout.trim();
      const run = await driver.run({
        cwd: project.path, prompt: composed, mode, sessionId, model, apiKey,
        onEvent: (incoming) => { void publish(incoming); }, abortSignal: controller.signal,
      });
      sessionId = run.sessionId || sessionId;
      if (run.exitCode !== 0) throw new Error(`${project.engine} exited with code ${run.exitCode}`);

      if (mode === 'plan') {
        message.text = summary || 'The implementation plan is ready. Switch to Build to apply it.';
        message.inProgress = false;
        await this.projects.update(project.id, { sessionId });
        await publish();
        return;
      }

      const gate = await this.gate.run({
        project, baseCommit, message: prompt, onEvent: (incoming) => { void publish(incoming); },
        repair: async (errors) => {
          const repairPrompt = await composePrompt(project, 'Fix the validation failures below without changing the requested feature.', this.resourcesRoot, errors);
          const repair = await driver.run({
            cwd: project.path, prompt: repairPrompt, mode: 'build', sessionId, model, apiKey,
            onEvent: (incoming) => { void publish(incoming); }, abortSignal: controller.signal,
          });
          sessionId = repair.sessionId || sessionId;
          if (repair.exitCode !== 0) throw new Error(`Repair run exited with code ${repair.exitCode}`);
        },
      });
      if (!gate.ok || !gate.tag) throw new Error(gate.error ?? 'Validation failed');
      const version = Number(gate.tag.slice(1));
      message.text = summary || `Built “${prompt}” and passed the validation gate.`;
      message.versionTag = gate.tag;
      message.inProgress = false;
      const updated = await this.projects.update(project.id, {
        latestVersion: version, currentTag: gate.tag, sessionId, lastEditedAt: now(),
      });
      this.emit('project-update', updated);
      await publish();
      if (this.previews.has(project.id)) {
        this.previews.stop(project.id);
        await this.runApp(project.id);
      }
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const detail = cancelled ? 'Run cancelled.' : error instanceof Error ? error.message : String(error);
      message.events!.push(event('error', cancelled ? 'Cancelled' : 'Run failed', 'fail', detail));
      message.text = detail;
      message.inProgress = false;
      await publish();
    } finally {
      this.runs.delete(project.id);
      await setStatus(this.previews.has(project.id) ? 'app-running' : 'idle');
    }
  }

  async cancelRun(projectId: string): Promise<void> {
    this.runs.get(projectId)?.abort();
  }

  async runApp(projectId: string): Promise<void> {
    const project = await this.projects.get(projectId);
    await this.projects.ensureDependencies(project);
    const logPath = join(project.path, '.kiln/preview.log');
    await writeFile(logPath, '');
    const child = this.previews.start(projectId, 'npm', ['run', 'dev'], {
      cwd: project.path,
      // Playwright/Electron development launchers can inject these into the
      // parent. They must never leak into a generated Electron app.
      env: { ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined },
    });
    child.stdout?.on('data', (chunk) => { void appendFile(logPath, chunk); });
    child.stderr?.on('data', (chunk) => { void appendFile(logPath, chunk); });
    this.emit('project-update', await this.projects.setStatus(projectId, 'app-running'));
    child.once('close', () => {
      void this.projects.setStatus(projectId, 'idle').then((updated) => this.emit('project-update', updated));
    });
  }

  async stopApp(projectId: string): Promise<void> {
    this.previews.stop(projectId);
    const extensionTest = this.extensionTests.get(projectId);
    if (extensionTest) {
      this.extensionTests.delete(projectId);
      await extensionTest.context.close();
      await rm(extensionTest.temporary, { recursive: true, force: true });
    }
    this.emit('project-update', await this.projects.setStatus(projectId, 'idle'));
  }

  async listVersions(projectId: string): Promise<Version[]> { return await this.projects.listVersions(projectId); }

  async revertTo(projectId: string, tag: string): Promise<void> {
    this.previews.stop(projectId);
    const updated = await this.projects.revert(projectId, tag);
    this.emit('project-update', updated);
    await this.runApp(projectId);
  }

  async listFiles(projectId: string): Promise<FileNode[]> { return await this.projects.listFiles(projectId); }
  async readFile(projectId: string, path: string): Promise<string> { return await this.projects.readFile(projectId, path); }

  async openInEditor(projectId: string, path?: string): Promise<void> {
    const project = await this.projects.get(projectId);
    const target = path ? safePath(project.path, path) : project.path;
    const result = await runCommand('/usr/bin/open', ['-a', 'Visual Studio Code', target]);
    if (result.code !== 0) await shell.openPath(target);
  }

  async exportProject(projectId: string): Promise<ExportResult> {
    const project = await this.projects.get(projectId);
    this.emit('project-update', await this.projects.setStatus(projectId, 'exporting'));
    const result = await this.packager.export(project);
    this.emit('project-update', await this.projects.setStatus(projectId, this.previews.has(projectId) ? 'app-running' : 'idle'));
    return result;
  }

  async testExtensionExport(projectId: string): Promise<void> {
    const project = await this.projects.get(projectId);
    if (project.type !== 'extension') throw new Error('Test in Chrome is only available for extension projects');
    await this.stopApp(projectId);
    this.emit('project-update', await this.projects.setStatus(projectId, 'exporting'));
    const result = await this.packager.export(project);
    if (!result.ok) {
      this.emit('project-update', await this.projects.setStatus(projectId, 'idle'));
      throw new Error(result.error ?? 'Extension export failed');
    }
    const chromeZip = result.artifacts.find((path) => path.endsWith('-chrome.zip'));
    if (!chromeZip) {
      this.emit('project-update', await this.projects.setStatus(projectId, 'idle'));
      throw new Error('Chrome ZIP was not produced');
    }
    const temporary = await mkdtemp(join(tmpdir(), 'kiln-chrome-export-'));
    const unpacked = join(temporary, 'extension');
    const unzip = await runCommand('/usr/bin/ditto', ['-x', '-k', chromeZip, unpacked]);
    if (unzip.code !== 0) {
      await rm(temporary, { recursive: true, force: true });
      this.emit('project-update', await this.projects.setStatus(projectId, 'idle'));
      throw new Error(unzip.stderr || 'Could not unpack Chrome ZIP');
    }
    try {
      const context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
        headless: false,
        args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`, '--no-first-run'],
      });
      let worker = context.serviceWorkers()[0];
      worker ??= await context.waitForEvent('serviceworker', { timeout: 20_000 });
      const manifest = JSON.parse(await this.projects.readFile(projectId, '.output/chrome-mv3/manifest.json')) as { action?: { default_popup?: string } };
      const page = await context.newPage();
      await page.goto(`chrome-extension://${new URL(worker.url()).host}/${manifest.action?.default_popup ?? 'popup.html'}`);
      this.extensionTests.set(projectId, { context, temporary });
      context.once('close', () => {
        this.extensionTests.delete(projectId);
        void rm(temporary, { recursive: true, force: true });
        void this.projects.setStatus(projectId, 'idle').then((updated) => this.emit('project-update', updated));
      });
      this.emit('project-update', await this.projects.setStatus(projectId, 'app-running'));
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      this.emit('project-update', await this.projects.setStatus(projectId, 'idle'));
      throw error;
    }
  }

  async revealPath(path: string): Promise<void> { shell.showItemInFolder(path); }
  async getEngines(): Promise<EngineStatus[]> { return await this.engines.statuses(); }
  async setApiKey(engine: EngineId, key: string): Promise<void> { await this.secrets.set(engine, key); }
  async clearApiKey(engine: EngineId): Promise<void> { await this.secrets.clear(engine); }
  async selectModel(engine: EngineId, model: string): Promise<void> { await this.settings.setModel(engine, model); }

  async testEngine(engineId: EngineId): Promise<{ ok: boolean; message: string }> {
    const engine = this.engines.get(engineId);
    const available = await engine.checkAvailable();
    if (!available.ok) return { ok: false, message: available.reason ?? 'Engine unavailable' };
    const apiKey = engineId.endsWith('byok') ? await this.secrets.get(engineId) : undefined;
    if (engineId.endsWith('byok') && !apiKey) return { ok: false, message: 'Add an API key first.' };
    const directory = await mkdtemp(join(tmpdir(), 'kiln-engine-'));
    try {
      await runCommand('git', ['init', '-b', 'main'], { cwd: directory });
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      const result = await engine.run({
        cwd: directory, prompt: 'Reply with exactly: OK. Do not inspect or edit files.', mode: 'plan',
        model: await this.settings.getModel(engineId), apiKey, onEvent: () => undefined, abortSignal: controller.signal,
      });
      clearTimeout(timer);
      return result.exitCode === 0
        ? { ok: true, message: `Round-trip OK — engine responded in ${((Date.now() - started) / 1000).toFixed(1)}s` }
        : { ok: false, message: `Engine exited with code ${result.exitCode}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async getSettings(): Promise<Settings> { return await this.settings.get(); }
  async updateSettings(patch: Partial<Settings>): Promise<Settings> { return await this.settings.update(patch); }

  shutdown(): void {
    for (const controller of this.runs.values()) controller.abort();
    this.runs.clear();
    this.previews.stopAll();
    for (const { context, temporary } of this.extensionTests.values()) {
      void context.close();
      void rm(temporary, { recursive: true, force: true });
    }
    this.extensionTests.clear();
  }
}
