import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, shell: {} }));

import type { ProjectRecord, ProjectRegistry } from '../projects/registry';
import { runCommand } from '../util/process';
import { ValidationGate } from './gate';

describe('ValidationGate repair loop', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kiln-gate-'));
    await mkdir(join(directory, '.kiln'), { recursive: true });
    await mkdir(join(directory, 'node_modules/.bin'), { recursive: true });
    const fakeElectron = join(directory, 'node_modules/.bin/electron');
    await writeFile(fakeElectron, "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.KILN_SMOKE_SCREENSHOT, 'png')\n");
    await chmod(fakeElectron, 0o755);
    await writeFile(join(directory, '.kiln/locked.json'), '{}\n');
    await writeFile(join(directory, '.gitignore'), '.kiln/\n');
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name: 'gate-fixture', version: '1.0.0', scripts: {
        typecheck: 'node check.mjs', lint: 'node check.mjs', build: 'node check.mjs',
      },
    }, null, 2));
    await writeFile(join(directory, 'check.mjs'), "import{readFileSync}from'node:fs';process.exit(readFileSync('feature.txt','utf8').includes('BROKEN')?1:0)\n");
    await writeFile(join(directory, 'feature.txt'), 'working\n');
    for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Kiln'], ['config', 'user.email', 'test@kiln.local'], ['add', '-A'], ['commit', '-m', 'base'], ['tag', 'kiln-base']]) {
      expect((await runCommand('git', args, { cwd: directory })).code).toBe(0);
    }
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('feeds failures back and tags the repaired result', async () => {
    await writeFile(join(directory, 'feature.txt'), 'BROKEN\n');
    const git = async (path: string, args: string[]) => {
      const result = await runCommand('git', args, { cwd: path });
      if (result.code !== 0) throw new Error(result.stderr);
      return result;
    };
    const registry = { git } as unknown as ProjectRegistry;
    const gate = new ValidationGate(registry);
    const project: ProjectRecord = {
      id: 'fixture', name: 'Fixture', slug: 'fixture', path: directory,
      type: 'mac-app', engine: 'codex-sub', status: 'idle', latestVersion: 0,
      createdAt: new Date().toISOString(), lastEditedAt: new Date().toISOString(),
    };
    const baseCommit = (await git(directory, ['rev-parse', 'HEAD'])).stdout.trim();
    let repairs = 0;
    const result = await gate.run({
      project, baseCommit, message: 'inject breakage', onEvent: () => undefined,
      repair: async () => { repairs += 1; await writeFile(join(directory, 'feature.txt'), 'repaired\n'); },
    });
    expect(result).toMatchObject({ ok: true, tag: 'v1' });
    expect(repairs).toBe(1);
    expect(await readFile(join(directory, 'feature.txt'), 'utf8')).toBe('repaired\n');
  }, 30_000);
});
