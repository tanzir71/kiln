import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeIcon } from './compose';

describe('icon pipeline', () => {
  let directory: string;
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'kiln-icons-')); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it('creates five distinct valid icns files', async () => {
    const names = ['Pomodoro Timer', 'Photo Resizer', 'Music Notes', 'Local Database', 'Browser Puzzle'];
    const hashes = new Set<string>();
    for (const name of names) {
      const result = await composeIcon({ name, target: 'mac', outDir: join(directory, name.replaceAll(' ', '-')) });
      const bytes = await readFile(result.icns!);
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('icns');
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(hashes.size).toBe(names.length);
  }, 30_000);
});
