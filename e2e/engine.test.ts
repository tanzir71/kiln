import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodexDriver } from '../src/main/agent/codex';
import { runCommand } from '../src/main/util/process';

const enabled = process.env.KILN_ENGINE_E2E === '1';

describe.skipIf(!enabled)('authenticated agent engine', () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kiln-codex-'));
    await writeFile(join(directory, 'README.md'), '# Engine acceptance fixture\n');
    await runCommand('git', ['init', '-b', 'main'], { cwd: directory });
    await runCommand('git', ['config', 'user.name', 'Kiln Test'], { cwd: directory });
    await runCommand('git', ['config', 'user.email', 'test@kiln.local'], { cwd: directory });
    await runCommand('git', ['add', '-A'], { cwd: directory });
    await runCommand('git', ['commit', '-m', 'fixture'], { cwd: directory });
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it('uses the authenticated Codex CLI to make a trivial edit', async () => {
    const driver = new CodexDriver(false);
    expect((await driver.checkAvailable()).ok).toBe(true);
    const result = await driver.run({
      cwd: directory,
      prompt: 'Create a file named hello.txt containing exactly `Kiln engine works` followed by a newline. Do not change any other file.',
      mode: 'build',
      onEvent: () => undefined,
      abortSignal: new AbortController().signal,
    });
    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBeTruthy();
    expect(await readFile(join(directory, 'hello.txt'), 'utf8')).toBe('Kiln engine works\n');
  }, 5 * 60_000);
});
