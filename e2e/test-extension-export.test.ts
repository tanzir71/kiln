import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.KILN_E2E === '1';

describe.skipIf(!enabled)('Test in Chrome product flow', () => {
  let temporary: string;
  let application: ElectronApplication;
  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'kiln-test-export-'));
    application = await electron.launch({ args: [resolve('.'), `--user-data-dir=${join(temporary, 'profile')}`] });
  });
  afterAll(async () => { await application?.close(); await rm(temporary, { recursive: true, force: true }); });

  it('exports, unpacks, and runs the exact Chrome ZIP', async () => {
    const page = await application.firstWindow();
    await page.getByText('My Projects').waitFor();
    const projectsDir = join(temporary, 'projects');
    const id = await page.evaluate(async ({ projectsDir }) => {
      await window.kiln!.updateSettings({ projectsDir });
      return (await window.kiln!.createProject({ name: 'Chrome Flow', type: 'extension', engine: 'codex-sub' })).id;
    }, { projectsDir });
    const metadataPath = join(projectsDir, 'chrome-flow/.kiln/project.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { latestVersion: number; currentTag?: string };
    metadata.latestVersion = 1;
    metadata.currentTag = 'v1';
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await page.evaluate((projectId) => window.kiln!.testExtensionExport(projectId), id);
    const status = await page.evaluate(async (projectId) => (await window.kiln!.listProjects()).find((project) => project.id === projectId)?.status, id);
    expect(status).toBe('app-running');
    await page.evaluate((projectId) => window.kiln!.stopApp(projectId), id);
  }, 5 * 60_000);
});
