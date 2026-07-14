import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import type { EngineId } from '../../../ui/src/types';
import { readJson, writeJson } from '../util/files';

type SecretMap = Partial<Record<EngineId, string>>;

export class SecretStore {
  private readonly path: string;

  constructor(userData = app.getPath('userData')) {
    this.path = join(userData, 'secrets.json');
  }

  async has(engine: EngineId): Promise<boolean> {
    return Boolean((await readJson<SecretMap>(this.path, {}))[engine]);
  }

  async get(engine: EngineId): Promise<string | undefined> {
    const encoded = (await readJson<SecretMap>(this.path, {}))[engine];
    if (!encoded) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is unavailable');
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  }

  async set(engine: EngineId, key: string): Promise<void> {
    if (!engine.endsWith('byok')) throw new Error('API keys are only valid for BYOK engines');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is unavailable');
    const values = await readJson<SecretMap>(this.path, {});
    values[engine] = safeStorage.encryptString(key).toString('base64');
    await writeJson(this.path, values);
  }

  async clear(engine: EngineId): Promise<void> {
    const values = await readJson<SecretMap>(this.path, {});
    delete values[engine];
    await writeJson(this.path, values);
  }
}
