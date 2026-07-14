import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.KILN_E2E === '1';

describe.skipIf(!enabled)('Kiln Electron shell', () => {
  let temporary: string;
  let application: ElectronApplication;

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'kiln-electron-'));
    application = await electron.launch({
      args: [resolve('.'), `--user-data-dir=${join(temporary, 'profile')}`],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      timeout: 30_000,
    });
  });
  afterAll(async () => {
    await application?.close();
    await rm(temporary, { recursive: true, force: true });
  });

  it('renders home, settings, and builder with the real preload API', async () => {
    const page = await application.firstWindow();
    await expect.poll(() => page.title()).toBe('Kiln');
    await page.getByText('My Projects').waitFor();
    expect(await page.getByText('MOCK BACKEND').count()).toBe(0);

    await page.getByTitle('Settings').click();
    await page.getByRole('heading', { name: 'Settings' }).waitFor();
    const projectId = await page.evaluate(async ({ projectsDir }) => {
      await window.kiln!.updateSettings({ projectsDir });
      return (await window.kiln!.createProject({ name: 'Electron Acceptance', type: 'mac-app', engine: 'codex-sub' })).id;
    }, { projectsDir: join(temporary, 'projects') });

    await page.getByTitle('Back').click();
    await page.reload();
    await page.getByText('Electron Acceptance').click();
    await page.getByText('No build yet.').waitFor();
    expect(await page.getByRole('button', { name: 'Export DMG' }).isDisabled()).toBe(true);
    expect(projectId).toBeTruthy();
  }, 30_000);
});
