import type { EngineId, EngineStatus } from '../../../ui/src/types';
import { ClaudeByokDriver, ClaudeSubscriptionDriver } from './claude';
import { CodexDriver } from './codex';
import type { AgentEngine } from './types';
import type { SecretStore } from '../secrets/store';
import type { SettingsStore } from '../settings/store';

const MODELS: Record<EngineId, string[]> = {
  'claude-sub': ['claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5'],
  'claude-byok': ['claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5'],
  'codex-sub': ['gpt-5.3-codex', 'gpt-5.3-codex-mini'],
  'codex-byok': ['gpt-5.3-codex', 'gpt-5.3-codex-mini'],
};

export class EngineRegistry {
  private readonly engines = new Map<EngineId, AgentEngine>([
    ['claude-sub', new ClaudeSubscriptionDriver()],
    ['claude-byok', new ClaudeByokDriver()],
    ['codex-sub', new CodexDriver(false)],
    ['codex-byok', new CodexDriver(true)],
  ]);

  constructor(private readonly secrets: SecretStore, private readonly settings: SettingsStore) {}

  get(id: EngineId): AgentEngine {
    const engine = this.engines.get(id);
    if (!engine) throw new Error(`Unknown engine: ${id}`);
    return engine;
  }

  async statuses(): Promise<EngineStatus[]> {
    return await Promise.all([...this.engines.entries()].map(async ([id, engine]) => {
      const available = await engine.checkAvailable();
      const byok = id.endsWith('byok');
      const hasKey = byok ? await this.secrets.has(id) : true;
      return {
        id,
        installed: id === 'claude-byok' ? true : available.ok || Boolean(available.version),
        authenticated: available.ok && hasKey,
        version: available.version,
        detail: !available.ok ? available.reason : byok && !hasKey ? 'Add an API key to enable.' : undefined,
        models: MODELS[id],
        selectedModel: await this.settings.getModel(id) ?? MODELS[id][0],
      };
    }));
  }
}
