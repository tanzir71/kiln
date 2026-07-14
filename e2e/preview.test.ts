import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.KILN_E2E === '1';
const pause = (ms: number) => new Promise((resolvePause) => setTimeout(resolvePause, ms));

describe.skipIf(!enabled)('generated app preview', () => {
  let temporary: string;
  let application: ElectronApplication;
  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'kiln-preview-'));
    application = await electron.launch({ args: [resolve('.'), `--user-data-dir=${join(temporary, 'profile')}`] });
  });
  afterAll(async () => { await application?.close(); await rm(temporary, { recursive: true, force: true }); });

  it('keeps the generated Electron app running', async () => {
    const page = await application.firstWindow();
    await page.getByText('My Projects').waitFor();
    const projectsDir = join(temporary, 'projects');
    const id = await page.evaluate(async ({ projectsDir }) => {
      await window.kiln!.updateSettings({ projectsDir });
      const project = await window.kiln!.createProject({ name: 'Preview Test', type: 'mac-app', engine: 'codex-sub' });
      await window.kiln!.runApp(project.id);
      return project.id;
    }, { projectsDir });
    await pause(6_000);
    const status = await page.evaluate(async (projectId) => (await window.kiln!.listProjects()).find((project) => project.id === projectId)?.status, id);
    const log = await readFile(join(projectsDir, 'preview-test/.kiln/preview.log'), 'utf8');
    expect(status, log).toBe('app-running');
    await page.evaluate((projectId) => window.kiln!.stopApp(projectId), id);
  }, 30_000);
});
