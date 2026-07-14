import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  shell: { trashItem: (path: string) => rm(path, { recursive: true, force: true }) },
}));

import { SettingsStore } from '../settings/store';
import { ProjectRegistry } from './registry';

describe('ProjectRegistry lifecycle', () => {
  let root: string;
  let projectsDir: string;
  let registry: ProjectRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kiln-projects-'));
    projectsDir = join(root, 'projects');
    const settings = new SettingsStore(join(root, 'user-data'));
    await settings.update({ projectsDir });
    registry = new ProjectRegistry(settings, resolve('.'));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('creates and reopens a project from disk', async () => {
    const created = await registry.create({ name: 'Lifecycle Test', type: 'mac-app', engine: 'codex-sub' });
    expect(created).toMatchObject({ name: 'Lifecycle Test', type: 'mac-app', latestVersion: 0 });
    const reopened = new ProjectRegistry(new SettingsStore(join(root, 'user-data')), resolve('.'));
    expect(await reopened.list()).toHaveLength(1);
    expect((await reopened.get(created.id)).slug).toBe('lifecycle-test');
  }, 30_000);

  it('reverts v1 after three edits and saves the revert as a new version', async () => {
    const created = await registry.create({ name: 'Version Test', type: 'mac-app', engine: 'codex-sub' });
    const record = await registry.get(created.id);
    const target = join(record.path, 'src/renderer/src/App.tsx');
    for (let version = 1; version <= 3; version += 1) {
      await writeFile(target, `export default function App(){ return <div>version ${version}</div> }\n`);
      await registry.git(record.path, ['add', '-A']);
      await registry.git(record.path, ['commit', '-m', `Version ${version}`]);
      await registry.git(record.path, ['tag', `v${version}`]);
      await registry.update(created.id, { latestVersion: version, currentTag: `v${version}` });
    }
    const reverted = await registry.revert(created.id, 'v1');
    expect(await readFile(target, 'utf8')).toContain('version 1');
    expect(reverted).toMatchObject({ latestVersion: 4 });
    expect((await registry.listVersions(created.id)).find((version) => version.tag === 'v4')?.current).toBe(true);
  }, 30_000);
});
