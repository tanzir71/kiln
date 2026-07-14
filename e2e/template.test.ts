import { access, cp, link, mkdir, mkdtemp, readlink, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeIcon } from '../harness/icons/compose';
import { runCommand } from '../src/main/util/process';

const enabled = process.env.KILN_E2E === '1';
const expectOk = (result: { code: number; stdout: string; stderr: string }) => expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);

async function linkTree(source: string, destination: string, sourceRoot = source, destinationRoot = destination): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await linkTree(from, to, sourceRoot, destinationRoot);
    else if (entry.isSymbolicLink()) {
      const target = await readlink(from);
      const markerAt = target.lastIndexOf('/node_modules/');
      const mapped = target.startsWith(sourceRoot)
        ? join(destinationRoot, relative(sourceRoot, target))
        : markerAt >= 0 ? join(destinationRoot, target.slice(markerAt + '/node_modules/'.length)) : target;
      await symlink(target.startsWith('/') ? relative(dirname(to), mapped) : target, to);
    }
    else { try { await link(from, to); } catch { await cp(from, to); } }
  }
}

async function installOrLink(project: string, cacheName: string): Promise<void> {
  const cache = join(homedir(), 'Kiln/cache', cacheName);
  try { await access(cache); await linkTree(cache, join(project, 'node_modules')); }
  catch { expectOk(await runCommand('npm', ['install'], { cwd: project, timeoutMs: 10 * 60_000 })); }
}

describe.skipIf(!enabled)('generated app template acceptance', () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'kiln-template-e2e-')); });
  afterAll(async () => { if (process.env.KILN_KEEP_E2E !== '1') await rm(root, { recursive: true, force: true }); });

  it('copies, installs, typechecks, and packages the Mac template', async () => {
    const project = join(root, 'mac-app');
    await cp(resolve('templates/app-base'), project, { recursive: true });
    for (const path of ['package.json', 'electron-builder.yml', 'src/renderer/index.html', 'src/renderer/src/App.tsx', 'build/notarize.cjs']) {
      const absolute = join(project, path);
      const content = (await readFile(absolute, 'utf8')).replaceAll('__APP_NAME__', 'Template Test').replaceAll('__APP_SLUG__', 'template-test').replaceAll('__APP_ID__', 'com.kiln.template.test');
      await writeFile(absolute, content);
    }
    await composeIcon({ name: 'Template Test', target: 'mac', outDir: join(project, 'resources') });
    await installOrLink(project, 'app-base-node_modules');
    expectOk(await runCommand('npm', ['run', 'typecheck'], { cwd: project, timeoutMs: 5 * 60_000 }));
    expectOk(await runCommand('npm', ['run', 'build'], { cwd: project, timeoutMs: 5 * 60_000 }));
    const screenshot = join(project, 'smoke.png');
    expectOk(await runCommand(join(project, 'node_modules/.bin/electron'), ['.'], {
      cwd: project, timeoutMs: 45_000,
      env: { KILN_SMOKE_SCREENSHOT: screenshot, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined },
    }));
    expect((await readFile(screenshot)).subarray(1, 4).toString('ascii')).toBe('PNG');
    const distResult = await runCommand('npm', ['run', 'dist'], { cwd: project, timeoutMs: 20 * 60_000, env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
    expectOk(distResult);
    const distNames = await readdir(join(project, 'dist'));
    const dmgName = distNames.find((name) => name.endsWith('.dmg'));
    expect(dmgName, `${distNames.join(', ')}\n${distResult.stdout}\n${distResult.stderr}`).toBeTruthy();
    const dmg = join(project, 'dist', dmgName!);
    expectOk(await runCommand('/usr/bin/hdiutil', ['verify', dmg], { timeoutMs: 60_000 }));
    const mountpoint = join(root, 'template-mounted');
    await mkdir(mountpoint);
    expectOk(await runCommand('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountpoint, dmg], { timeoutMs: 60_000 }));
    try {
      const appName = (await readdir(mountpoint)).find((name) => name.endsWith('.app'));
      expect(appName).toBeTruthy();
      expectOk(await runCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', join(mountpoint, appName!)]));
    } finally {
      expectOk(await runCommand('/usr/bin/hdiutil', ['detach', '-force', mountpoint], { timeoutMs: 60_000 }));
    }
  }, 30 * 60_000);

  it('copies, installs, typechecks, and builds the extension template', async () => {
    const project = join(root, 'extension');
    await cp(resolve('templates/ext-base'), project, { recursive: true });
    for (const path of ['package.json', 'wxt.config.ts', 'entrypoints/popup/index.html', 'entrypoints/popup/main.tsx', 'entrypoints/options/index.html', 'entrypoints/options/main.tsx']) {
      const absolute = join(project, path);
      const content = (await readFile(absolute, 'utf8')).replaceAll('__APP_NAME__', 'Extension Test').replaceAll('__APP_SLUG__', 'extension-test').replaceAll('__APP_ID__', 'com.kiln.extension.test');
      await writeFile(absolute, content);
    }
    await composeIcon({ name: 'Extension Test', target: 'extension', outDir: join(project, 'public') });
    await installOrLink(project, 'ext-base-node_modules');
    expectOk(await runCommand('npm', ['run', 'typecheck'], { cwd: project, timeoutMs: 5 * 60_000 }));
    expectOk(await runCommand('npm', ['run', 'build'], { cwd: project, timeoutMs: 5 * 60_000 }));
    const manifest = JSON.parse(await readFile(join(project, '.output/chrome-mv3/manifest.json'), 'utf8')) as { manifest_version: number };
    expect(manifest.manifest_version).toBe(3);
    expectOk(await runCommand('npm', ['run', 'zip'], { cwd: project, timeoutMs: 5 * 60_000 }));
    const chromeZip = (await readdir(join(project, '.output'))).find((name) => name.endsWith('-chrome.zip'));
    expect(chromeZip).toBeTruthy();
    const unpacked = join(root, 'extension-unpacked');
    expectOk(await runCommand('/usr/bin/ditto', ['-x', '-k', join(project, '.output', chromeZip!), unpacked]));
    const context = await chromium.launchPersistentContext(join(root, 'extension-profile'), {
      headless: false,
      args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`],
    });
    try {
      let worker = context.serviceWorkers()[0];
      worker ??= await context.waitForEvent('serviceworker', { timeout: 20_000 });
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
      expect((await popup.locator('body').innerText()).trim()).toContain('Extension Test');
    } finally {
      await context.close();
    }
  }, 20 * 60_000);
});
