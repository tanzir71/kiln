/**
 * KilnAPI — the contract between this UI and the Electron main process.
 *
 * CODEX: implement this exact interface in the preload script and expose it as
 * `window.kiln` via contextBridge. Do NOT change signatures without updating
 * the UI; the UI is the source of truth for this file. When running outside
 * Electron (plain `vite dev`), src/api.ts substitutes a mock implementation.
 */

export type ProjectType = 'mac-app' | 'extension';
export type EngineId = 'claude-sub' | 'claude-byok' | 'codex-sub' | 'codex-byok';
export type RunMode = 'plan' | 'build';
export type ProjectStatus = 'idle' | 'agent-running' | 'app-running' | 'exporting';

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  engine: EngineId;
  /** data: URL of the generated icon, if any */
  icon?: string;
  status: ProjectStatus;
  latestVersion: number;
  createdAt: string;
  lastEditedAt: string;
}

/** One step inside an agent turn (rendered as a collapsible row). */
export interface AgentEvent {
  id: string;
  kind: 'thinking' | 'read' | 'edit' | 'command' | 'gate' | 'text' | 'error';
  /** Short label, e.g. `Editing src/renderer/App.tsx` or `npm run typecheck` */
  label: string;
  /** Collapsible body: diff excerpt, command output, plan text, ... */
  detail?: string;
  status: 'running' | 'ok' | 'fail';
  ts: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  mode: RunMode;
  /** User prompt text, or the agent's final summary text. */
  text: string;
  /** Present on agent messages: the streamed steps of the turn. */
  events?: AgentEvent[];
  /** Version tag created by this turn (e.g. "v3"), once the gate passes. */
  versionTag?: string;
  /** True while the turn is still streaming. */
  inProgress?: boolean;
  ts: string;
}

export interface Version {
  tag: string;
  message: string;
  ts: string;
  /** data: URL screenshot captured by the smoke test */
  screenshot?: string;
  current: boolean;
}

export interface EngineStatus {
  id: EngineId;
  installed: boolean;
  authenticated: boolean;
  version?: string;
  /** Human hint, e.g. "Run `codex login` to sign in" */
  detail?: string;
  models: string[];
  selectedModel?: string;
}

export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: FileNode[];
}

export interface Settings {
  defaultEngine: EngineId;
  projectsDir: string;
  /** Developer ID signing (optional distribution path) */
  signingIdentity?: string;
  notarize: boolean;
}

export interface ExportResult {
  ok: boolean;
  /** Absolute paths of produced artifacts (dmg / zips) */
  artifacts: string[];
  error?: string;
}

export interface KilnAPI {
  // Projects
  listProjects(): Promise<Project[]>;
  createProject(input: { name: string; type: ProjectType; engine: EngineId }): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  // Chat / agent
  getChat(projectId: string): Promise<ChatMessage[]>;
  sendPrompt(projectId: string, prompt: string, mode: RunMode): Promise<void>;
  cancelRun(projectId: string): Promise<void>;
  /** Subscribe to streamed chat updates (new/updated messages). Returns unsubscribe. */
  onChatUpdate(cb: (projectId: string, message: ChatMessage) => void): () => void;
  /** Subscribe to project status changes. Returns unsubscribe. */
  onProjectUpdate(cb: (project: Project) => void): () => void;

  // Preview
  runApp(projectId: string): Promise<void>;
  stopApp(projectId: string): Promise<void>;

  // Versions
  listVersions(projectId: string): Promise<Version[]>;
  revertTo(projectId: string, tag: string): Promise<void>;

  // Files
  listFiles(projectId: string): Promise<FileNode[]>;
  readFile(projectId: string, path: string): Promise<string>;
  openInEditor(projectId: string, path?: string): Promise<void>;

  // Export
  exportProject(projectId: string): Promise<ExportResult>;
  /** Export, unpack, and launch the exact Chrome ZIP for an extension project. */
  testExtensionExport(projectId: string): Promise<void>;
  revealPath(path: string): Promise<void>;

  // Engines & settings
  getEngines(): Promise<EngineStatus[]>;
  setApiKey(engine: EngineId, key: string): Promise<void>;
  clearApiKey(engine: EngineId): Promise<void>;
  selectModel(engine: EngineId, model: string): Promise<void>;
  testEngine(engine: EngineId): Promise<{ ok: boolean; message: string }>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
}

export const ENGINE_LABELS: Record<EngineId, { name: string; sub: string }> = {
  'claude-sub': { name: 'Claude', sub: 'Claude subscription · Claude Code CLI' },
  'claude-byok': { name: 'Claude API', sub: 'Bring your own Anthropic key' },
  'codex-sub': { name: 'Codex', sub: 'ChatGPT subscription · Codex CLI' },
  'codex-byok': { name: 'Codex API', sub: 'Bring your own OpenAI key' },
};
