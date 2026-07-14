import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatMessage, Project } from '../ui/src/types';
import { runCommand } from '../src/main/util/process';

const enabled = process.env.KILN_PROMPT_E2E === '1';
const pause = (ms: number) => new Promise((resolvePause) => setTimeout(resolvePause, ms));

async function waitForVersion(page: Page, id: string, timeoutMs: number): Promise<Project> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(async (projectId) => ({
      project: (await window.kiln!.listProjects()).find((item) => item.id === projectId),
      chat: await window.kiln!.getChat(projectId),
    }), id) as { project?: Project; chat: ChatMessage[] };
    if (state.project?.latestVersion) return state.project;
    const last = state.chat.at(-1);
    if (state.project?.status === 'idle' && last?.role === 'agent' && last.inProgress === false) {
      throw new Error(`Agent run ended without a version: ${last.text}`);
    }
    await pause(1_000);
  }
  throw new Error('Timed out waiting for generated project version');
}

describe.skipIf(!enabled)('prompt to DMG acceptance', () => {
  let temporary: string;
  let application: ElectronApplication;
  let page: Page;
  const exported: string[] = [];

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'kiln-prompt-'));
    application = await electron.launch({ args: [resolve('.'), `--user-data-dir=${join(temporary, 'profile')}`], timeout: 30_000 });
    page = await application.firstWindow();
    await page.getByText('My Projects').waitFor();
  });
  afterAll(async () => {
    await application?.close();
    for (const path of exported) await rm(path, { force: true });
    await runCommand('/usr/bin/hdiutil', ['detach', '-force', join(temporary, 'mounted')], { timeoutMs: 60_000 });
    await rm(temporary, { recursive: true, force: true });
  });

  it('builds, launches, exports, mounts, and launches a pomodoro app', async () => {
    const projectsDir = join(temporary, 'projects');
    const id = await page.evaluate(async ({ projectsDir }) => {
      await window.kiln!.updateSettings({ projectsDir });
      const project = await window.kiln!.createProject({ name: 'Pomodoro Acceptance', type: 'mac-app', engine: 'codex-sub' });
      await window.kiln!.sendPrompt(project.id, 'Make a pomodoro timer with a 25/5 cycle and a menu bar countdown.', 'build');
      return project.id;
    }, { projectsDir });
    const built = await waitForVersion(page, id, 10 * 60_000);
    expect(built.latestVersion).toBe(1);
    const versions = await page.evaluate((projectId) => window.kiln!.listVersions(projectId), id);
    expect(versions[0]).toMatchObject({ tag: 'v1', current: true });

    const sourceCheck = await runCommand('rg', ['-n', '25|menu bar|tray|countdown', 'src'], { cwd: join(projectsDir, 'pomodoro-acceptance') });
    expect(sourceCheck.code, sourceCheck.stderr).toBe(0);

    await page.evaluate((projectId) => window.kiln!.runApp(projectId), id);
    await pause(6_000);
    const running = await page.evaluate(async (projectId) => (await window.kiln!.listProjects()).find((item) => item.id === projectId)?.status, id);
    expect(running).toBe('app-running');
    await page.evaluate((projectId) => window.kiln!.stopApp(projectId), id);

    const result = await page.evaluate((projectId) => window.kiln!.exportProject(projectId), id);
    expect(result.ok, result.error).toBe(true);
    exported.push(...result.artifacts);
    const dmg = result.artifacts.find((path) => path.endsWith('.dmg'));
    expect(dmg).toBeTruthy();

    const mountpoint = join(temporary, 'mounted');
    await mkdir(mountpoint);
    const attached = await runCommand('/usr/bin/hdiutil', ['attach', '-nobrowse', '-mountpoint', mountpoint, dmg!], { timeoutMs: 60_000 });
    expect(attached.code, attached.stderr).toBe(0);
    try {
      const appName = (await readdir(mountpoint)).find((name) => name.endsWith('.app'));
      expect(appName).toBeTruthy();
      const installedDir = join(temporary, 'Applications');
      await mkdir(installedDir);
      const installed = join(installedDir, appName!);
      await cp(join(mountpoint, appName!), installed, { recursive: true });
      expect((await runCommand('/usr/bin/open', [installed])).code).toBe(0);
      await pause(4_000);
      const process = await runCommand('/usr/bin/pgrep', ['-f', installed]);
      expect(process.code, 'Packaged app did not stay running').toBe(0);
      await runCommand('/usr/bin/pkill', ['-f', installed]);
    } finally {
      const detached = await runCommand('/usr/bin/hdiutil', ['detach', '-force', mountpoint], { timeoutMs: 60_000 });
      expect(detached.code, detached.stderr).toBe(0);
    }
  }, 15 * 60_000);
});
