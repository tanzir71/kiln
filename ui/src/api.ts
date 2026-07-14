/**
 * API accessor. In Electron, window.kiln is provided by the preload script.
 * In a plain browser (vite dev), a mock backend simulates the full flow so
 * the UI can be developed and reviewed standalone.
 */
import type {
  AgentEvent, ChatMessage, EngineStatus, ExportResult, FileNode, KilnAPI,
  Project, RunMode, Settings, Version,
} from './types';

declare global {
  interface Window { kiln?: KilnAPI }
}

// ---------------------------------------------------------------- mock impl

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SVG_ICON = (hue: number, glyph: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},80%,62%)"/><stop offset="1" stop-color="hsl(${hue + 30},75%,45%)"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="14" fill="url(#g)"/><text x="32" y="41" font-size="26" text-anchor="middle" fill="white" font-family="-apple-system,sans-serif">${glyph}</text></svg>`,
  )}`;

function makeMock(): KilnAPI {
  const projects: Project[] = [
    {
      id: 'p1', name: 'Pomodoro', type: 'mac-app', engine: 'claude-sub',
      icon: SVG_ICON(10, '⏱'), status: 'idle', latestVersion: 4,
      createdAt: now(), lastEditedAt: new Date(Date.now() - 36e5).toISOString(),
    },
    {
      id: 'p2', name: 'Price Peek', type: 'extension', engine: 'codex-sub',
      icon: SVG_ICON(210, '€'), status: 'idle', latestVersion: 2,
      createdAt: now(), lastEditedAt: new Date(Date.now() - 864e5).toISOString(),
    },
  ];

  const chats = new Map<string, ChatMessage[]>([
    ['p1', [
      { id: uid(), role: 'user', mode: 'build', text: 'Make a pomodoro timer with a 25/5 cycle and a menu bar countdown.', ts: now() },
      {
        id: uid(), role: 'agent', mode: 'build', versionTag: 'v1', ts: now(),
        text: 'Built a pomodoro timer with a 25/5 work-break cycle, a large dial, and a live menu bar countdown.',
        events: [
          { id: uid(), kind: 'thinking', label: 'Planning approach', status: 'ok', ts: now() },
          { id: uid(), kind: 'edit', label: 'Editing src/renderer/App.tsx', status: 'ok', ts: now(), detail: '+ TimerDial component\n+ cycle state machine (25/5)' },
          { id: uid(), kind: 'edit', label: 'Editing src/main/bridge/tray.ts usage', status: 'ok', ts: now() },
          { id: uid(), kind: 'command', label: 'npm run typecheck', status: 'ok', ts: now(), detail: '0 errors' },
          { id: uid(), kind: 'gate', label: 'Validation gate — typecheck, lint, smoke test', status: 'ok', ts: now() },
        ],
      },
    ]],
  ]);

  const chatSubs = new Set<(pid: string, m: ChatMessage) => void>();
  const projSubs = new Set<(p: Project) => void>();
  const emitProj = (p: Project) => projSubs.forEach((f) => f({ ...p }));

  const engines: EngineStatus[] = [
    { id: 'claude-sub', installed: true, authenticated: true, version: '2.3.1', models: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5'], selectedModel: 'claude-sonnet-5' },
    { id: 'claude-byok', installed: true, authenticated: false, detail: 'Add an Anthropic API key to enable.', models: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5'] },
    { id: 'codex-sub', installed: true, authenticated: true, version: '0.48.0', models: ['gpt-5.3-codex', 'gpt-5.3-codex-mini'], selectedModel: 'gpt-5.3-codex' },
    { id: 'codex-byok', installed: false, authenticated: false, detail: 'Codex CLI not found. npm install -g @openai/codex', models: [] },
  ];

  let settings: Settings = { defaultEngine: 'claude-sub', projectsDir: '~/Kiln/projects', notarize: false };

  async function simulateRun(projectId: string, prompt: string, mode: RunMode) {
    const project = projects.find((p) => p.id === projectId)!;
    const chat = chats.get(projectId) ?? [];
    chats.set(projectId, chat);

    chat.push({ id: uid(), role: 'user', mode, text: prompt, ts: now() });
    chatSubs.forEach((f) => f(projectId, chat[chat.length - 1]));

    project.status = 'agent-running';
    emitProj(project);

    const msg: ChatMessage = { id: uid(), role: 'agent', mode, text: '', events: [], inProgress: true, ts: now() };
    chat.push(msg);
    const push = (e: Omit<AgentEvent, 'id' | 'ts'>) => {
      msg.events!.push({ ...e, id: uid(), ts: now() });
      chatSubs.forEach((f) => f(projectId, { ...msg }));
    };
    const settle = (status: 'ok' | 'fail') => {
      const last = msg.events![msg.events!.length - 1];
      if (last) { last.status = status; chatSubs.forEach((f) => f(projectId, { ...msg })); }
    };

    push({ kind: 'thinking', label: mode === 'plan' ? 'Drafting a plan' : 'Planning approach', status: 'running' });
    await sleep(900); settle('ok');

    if (mode === 'plan') {
      msg.text = `Here's the plan:\n\n1. Add a settings pane for the requested change.\n2. Wire it to persisted state via the store bridge.\n3. Update the main view to react to the new setting.\n\nSwitch to Build and send again to apply.`;
      msg.inProgress = false;
      chatSubs.forEach((f) => f(projectId, { ...msg }));
      project.status = 'idle'; emitProj(project);
      return;
    }

    push({ kind: 'read', label: 'Reading project files', status: 'running' });
    await sleep(700); settle('ok');
    push({ kind: 'edit', label: 'Editing src/renderer/App.tsx', status: 'running', detail: '+ implemented request\n~ refactored view state' });
    await sleep(1400); settle('ok');
    push({ kind: 'command', label: 'npm run typecheck', status: 'running' });
    await sleep(1000); settle('ok');
    push({ kind: 'gate', label: 'Validation gate — lint, smoke test, screenshot', status: 'running' });
    await sleep(1200); settle('ok');

    project.latestVersion += 1;
    project.lastEditedAt = now();
    msg.text = `Done — ${prompt.length > 60 ? prompt.slice(0, 57) + '…' : prompt}`;
    msg.versionTag = `v${project.latestVersion}`;
    msg.inProgress = false;
    chatSubs.forEach((f) => f(projectId, { ...msg }));
    project.status = 'idle'; emitProj(project);
  }

  return {
    async listProjects() { return projects.map((p) => ({ ...p })); },
    async createProject({ name, type, engine }) {
      const p: Project = {
        id: uid(), name, type, engine, status: 'idle', latestVersion: 0,
        icon: SVG_ICON(Math.floor(Math.random() * 360), name[0]?.toUpperCase() ?? 'K'),
        createdAt: now(), lastEditedAt: now(),
      };
      projects.unshift(p); chats.set(p.id, []);
      return { ...p };
    },
    async deleteProject(id) {
      const i = projects.findIndex((p) => p.id === id);
      if (i >= 0) projects.splice(i, 1);
      chats.delete(id);
    },
    async getChat(projectId) { return (chats.get(projectId) ?? []).map((m) => ({ ...m })); },
    async sendPrompt(projectId, prompt, mode) { void simulateRun(projectId, prompt, mode); },
    async cancelRun(projectId) {
      const p = projects.find((x) => x.id === projectId);
      if (p) { p.status = 'idle'; emitProj(p); }
    },
    onChatUpdate(cb) { chatSubs.add(cb); return () => chatSubs.delete(cb); },
    onProjectUpdate(cb) { projSubs.add(cb); return () => projSubs.delete(cb); },
    async runApp(projectId) {
      const p = projects.find((x) => x.id === projectId)!;
      p.status = 'app-running'; emitProj(p);
    },
    async stopApp(projectId) {
      const p = projects.find((x) => x.id === projectId)!;
      p.status = 'idle'; emitProj(p);
    },
    async listVersions(projectId): Promise<Version[]> {
      const p = projects.find((x) => x.id === projectId)!;
      return Array.from({ length: p.latestVersion }, (_, i) => ({
        tag: `v${p.latestVersion - i}`,
        message: i === 0 ? 'Latest build' : `Iteration ${p.latestVersion - i}`,
        ts: new Date(Date.now() - i * 42e5).toISOString(),
        current: i === 0,
      }));
    },
    async revertTo() { /* mock no-op */ },
    async listFiles(): Promise<FileNode[]> {
      return [
        { name: 'src', path: 'src', kind: 'dir', children: [
          { name: 'main', path: 'src/main', kind: 'dir', children: [
            { name: 'index.ts', path: 'src/main/index.ts', kind: 'file' },
          ]},
          { name: 'renderer', path: 'src/renderer', kind: 'dir', children: [
            { name: 'App.tsx', path: 'src/renderer/App.tsx', kind: 'file' },
            { name: 'ui', path: 'src/renderer/ui', kind: 'dir', children: [
              { name: 'Button.tsx', path: 'src/renderer/ui/Button.tsx', kind: 'file' },
            ]},
          ]},
        ]},
        { name: 'package.json', path: 'package.json', kind: 'file' },
      ];
    },
    async readFile(_pid, path) {
      return `// ${path}\n// (mock preview — real content comes from the Electron backend)\n\nexport default function Example() {\n  return <div>Hello from ${path}</div>;\n}\n`;
    },
    async openInEditor() { /* mock no-op */ },
    async exportProject(projectId): Promise<ExportResult> {
      const p = projects.find((x) => x.id === projectId)!;
      p.status = 'exporting'; emitProj(p);
      await sleep(2200);
      p.status = 'idle'; emitProj(p);
      return {
        ok: true,
        artifacts: p.type === 'mac-app'
          ? [`~/Kiln/dist/${p.name}-1.0.${p.latestVersion}.dmg`]
          : [`~/Kiln/dist/${p.name}-1.0.${p.latestVersion}-chrome.zip`, `~/Kiln/dist/${p.name}-1.0.${p.latestVersion}-firefox.zip`],
      };
    },
    async testExtensionExport() { await sleep(800); },
    async revealPath() { /* mock no-op */ },
    async getEngines() { return engines.map((e) => ({ ...e })); },
    async setApiKey(engine) {
      const e = engines.find((x) => x.id === engine)!;
      e.authenticated = true; e.detail = undefined;
    },
    async clearApiKey(engine) {
      const e = engines.find((x) => x.id === engine)!;
      e.authenticated = false;
    },
    async selectModel(engine, model) {
      const e = engines.find((x) => x.id === engine)!;
      e.selectedModel = model;
    },
    async testEngine(engine) {
      await sleep(1200);
      const e = engines.find((x) => x.id === engine)!;
      return e.installed && e.authenticated
        ? { ok: true, message: 'Round-trip OK — engine responded in 1.2s' }
        : { ok: false, message: e.detail ?? 'Engine unavailable' };
    },
    async getSettings() { return { ...settings }; },
    async updateSettings(patch) { settings = { ...settings, ...patch }; return { ...settings }; },
  };
}

export const api: KilnAPI = window.kiln ?? makeMock();
export const isMock = !window.kiln;
