import { app } from 'electron';
import { join } from 'node:path';
import type { EngineId, Settings } from '../../../ui/src/types';
import { readJson, writeJson } from '../util/files';

interface StoredSettings extends Settings {
  models: Partial<Record<EngineId, string>>;
}

export class SettingsStore {
  private value?: StoredSettings;
  private readonly path: string;

  constructor(userData = app.getPath('userData')) {
    this.path = join(userData, 'settings.json');
  }

  async getStored(): Promise<StoredSettings> {
    if (!this.value) {
      this.value = await readJson<StoredSettings>(this.path, {
        defaultEngine: 'codex-sub',
        projectsDir: '~/Kiln/projects',
        notarize: false,
        models: {},
      });
    }
    return { ...this.value, models: { ...this.value.models } };
  }

  async get(): Promise<Settings> {
    const { models: _models, ...settings } = await this.getStored();
    return settings;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.getStored();
    this.value = { ...current, ...patch, models: current.models };
    await writeJson(this.path, this.value);
    return await this.get();
  }

  async getModel(engine: EngineId): Promise<string | undefined> {
    return (await this.getStored()).models[engine];
  }

  async setModel(engine: EngineId, model: string): Promise<void> {
    const current = await this.getStored();
    this.value = { ...current, models: { ...current.models, [engine]: model } };
    await writeJson(this.path, this.value);
  }
}
