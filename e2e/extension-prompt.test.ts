import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, chromium, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatMessage, Project } from '../ui/src/types';
import { runCommand } from '../src/main/util/process';

const enabled = process.env.KILN_EXTENSION_E2E === '1';
const pause = (ms: number) => new Promise((resolvePause) => setTimeout(resolvePause, ms));

async function waitForVersion(page: Page, id: string): Promise<Project> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(async (projectId) => ({
      project: (await window.kiln!.listProjects()).find((item) => item.id === projectId),
      chat: await window.kiln!.getChat(projectId),
    }), id) as { project?: Project; chat: ChatMessage[] };
    if (state.project?.latestVersion) return state.project;
    const last = state.chat.at(-1);
    if (state.project?.status === 'idle' && last?.role === 'agent' && last.inProgress === false) throw new Error(last.text);
    await pause(1_000);
  }
  throw new Error('Timed out waiting for extension build');
}

describe.skipIf(!enabled)('prompt to extension ZIP acceptance', () => {
  let temporary: string;
  let application: ElectronApplication;
  let page: Page;
  const exported: string[] = [];
  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'kiln-extension-'));
    application = await electron.launch({ args: [resolve('.'), `--user-data-dir=${join(temporary, 'profile')}`] });
    page = await application.firstWindow();
    await page.getByText('My Projects').waitFor();
  });
  afterAll(async () => {
    await application?.close();
    for (const path of exported) await rm(path, { force: true });
    await rm(temporary, { recursive: true, force: true });
  });

  it('builds store ZIPs and loads the exact Chrome artifact', async () => {
    const projectsDir = join(temporary, 'projects');
    const id = await page.evaluate(async ({ projectsDir }) => {
      await window.kiln!.updateSettings({ projectsDir });
      const project = await window.kiln!.createProject({ name: 'Price Converter', type: 'extension', engine: 'codex-sub' });
      await window.kiln!.sendPrompt(project.id, 'An extension that highlights all prices on a page and converts them to EUR in a tooltip, with a storage-backed currency setting in the popup.', 'build');
      return project.id;
    }, { projectsDir });
    expect((await waitForVersion(page, id)).latestVersion).toBe(1);
    const sourceCheck = await runCommand('rg', ['-n', 'EUR|price|storage', 'entrypoints', 'utils'], { cwd: join(projectsDir, 'price-converter') });
    expect(sourceCheck.code, sourceCheck.stderr).toBe(0);

    const result = await page.evaluate((projectId) => window.kiln!.exportProject(projectId), id);
    expect(result.ok, result.error).toBe(true);
    exported.push(...result.artifacts);
    const chromeZip = result.artifacts.find((path) => path.endsWith('-chrome.zip'));
    expect(chromeZip).toBeTruthy();
    expect(result.artifacts.some((path) => path.endsWith('-firefox.zip'))).toBe(true);
    expect(result.artifacts.some((path) => path.endsWith('-sources.zip'))).toBe(true);

    const unpacked = join(temporary, 'unpacked');
    expect((await runCommand('/usr/bin/ditto', ['-x', '-k', chromeZip!, unpacked])).code).toBe(0);
    const manifest = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8')) as { manifest_version: number; action?: { default_popup?: string } };
    expect(manifest.manifest_version).toBe(3);

    const context = await chromium.launchPersistentContext(join(temporary, 'chrome-profile'), {
      headless: false,
      args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`, '--no-first-run'],
    });
    try {
      let worker = context.serviceWorkers()[0];
      worker ??= await context.waitForEvent('serviceworker', { timeout: 20_000 });
      const extensionId = new URL(worker.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/${manifest.action?.default_popup ?? 'popup.html'}`);
      await popup.locator('body').waitFor();
      expect((await popup.locator('body').innerText()).trim().length).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  }, 15 * 60_000);
});
