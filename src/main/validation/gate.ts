import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { AgentEvent, ProjectType } from '../../../ui/src/types';
import { event } from '../agent/types';
import type { ProjectRecord, ProjectRegistry } from '../projects/registry';
import { pathExists, readJson, safePath, writeJson } from '../util/files';
import { runCommand } from '../util/process';

const ALLOWED = new Set([
  'react', 'react-dom', 'electron', 'electron-vite', 'electron-builder', 'typescript', 'vite',
  'tailwindcss', 'postcss', 'autoprefixer', '@vitejs/plugin-react', '@types/node', '@types/react', '@types/react-dom',
  'eslint', '@typescript-eslint/parser', '@typescript-eslint/eslint-plugin', '@electron/notarize', 'lucide-react', 'recharts', 'date-fns', 'electron-store',
  'ffmpeg-static', 'fluent-ffmpeg', 'nodejs-whisper', 'sharp', 'better-sqlite3', 'xlsx', 'pdf-lib', 'pdfjs-dist',
  'tesseract.js', 'menubar', 'node-mac-permissions', 'marked', 'dompurify',
  'wxt', '@wxt-dev/module-react', 'webextension-polyfill', '@types/webextension-polyfill',
]);

interface GateOptions {
  project: ProjectRecord;
  baseCommit: string;
  message: string;
  onEvent: (event: AgentEvent) => void;
  repair: (errors: string) => Promise<void>;
}

export interface GateResult {
  ok: boolean;
  tag?: string;
  error?: string;
}

async function command(project: ProjectRecord, args: string[], label: string, onEvent: GateOptions['onEvent']): Promise<{ ok: boolean; output: string }> {
  const id = crypto.randomUUID();
  onEvent(event('gate', label, 'running', undefined, id));
  const result = await runCommand(args[0], args.slice(1), { cwd: project.path, timeoutMs: 5 * 60_000 });
  const output = `${result.stdout}${result.stderr}`.trim();
  onEvent(event('gate', label, result.code === 0 ? 'ok' : 'fail', output || (result.code === 0 ? 'Passed' : 'Failed'), id));
  return { ok: result.code === 0, output };
}

function permissionBlock(value: string): string {
  return value.match(/\/\/ KILN_MANIFEST_PERMISSIONS_START[\s\S]*?\/\/ KILN_MANIFEST_PERMISSIONS_END/)?.[0] ?? '';
}

function withoutPermissionBlock(value: string): string {
  return value.replace(/\/\/ KILN_MANIFEST_PERMISSIONS_START[\s\S]*?\/\/ KILN_MANIFEST_PERMISSIONS_END/, '// KILN_MANIFEST_PERMISSIONS_BLOCK');
}

export class ValidationGate {
  constructor(private readonly projects: ProjectRegistry) {}

  private async sanitizeLocked(project: ProjectRecord, onEvent: GateOptions['onEvent']): Promise<string[]> {
    const warnings: string[] = [];
    const locked = await readJson<Record<string, string>>(join(project.path, '.kiln/locked.json'), {});
    for (const path of Object.keys(locked)) {
      const baselineResult = await runCommand('git', ['show', `kiln-base:${path}`], { cwd: project.path });
      if (baselineResult.code !== 0) continue;
      const absolute = safePath(project.path, path);
      const current = await readFile(absolute, 'utf8');
      const baseline = baselineResult.stdout;
      let replacement = baseline;
      let modified = current !== baseline;
      if (project.type === 'extension' && path === 'wxt.config.ts') {
        modified = withoutPermissionBlock(current) !== withoutPermissionBlock(baseline);
        replacement = baseline.replace(permissionBlock(baseline), permissionBlock(current) || permissionBlock(baseline));
      }
      if (modified) {
        await writeFile(absolute, replacement);
        const warning = `Restored protected portions of ${path}`;
        warnings.push(warning);
        onEvent(event('gate', warning, 'ok'));
      }
    }
    return warnings;
  }

  private async auditDependencies(project: ProjectRecord, onEvent: GateOptions['onEvent']): Promise<string[]> {
    const packagePath = join(project.path, 'package.json');
    const pkg = await readJson<any>(packagePath, {});
    const removed: string[] = [];
    for (const section of ['dependencies', 'devDependencies'] as const) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        if (!ALLOWED.has(name)) { delete pkg[section][name]; removed.push(name); }
      }
    }
    if (removed.length) {
      await writeJson(packagePath, pkg);
      onEvent(event('gate', `Removed non-allowlisted dependencies: ${removed.join(', ')}`, 'fail'));
      await runCommand('npm', ['install'], { cwd: project.path, timeoutMs: 10 * 60_000 });
    } else {
      onEvent(event('gate', 'Dependency allowlist', 'ok', 'All dependencies are approved.'));
    }
    return removed;
  }

  private async validateManifest(project: ProjectRecord): Promise<string | undefined> {
    if (project.type !== 'extension') return undefined;
    const path = join(project.path, '.output/chrome-mv3/manifest.json');
    if (!(await pathExists(path))) return 'WXT did not produce a Chrome MV3 manifest';
    const manifest = await readJson<any>(path, {});
    if (manifest.manifest_version !== 3 || !manifest.name || !manifest.version || !manifest.description) {
      return 'Generated manifest is missing manifest_version=3, name, version, or description';
    }
    const broad = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])].filter((permission) => ['<all_urls>', 'tabs', 'scripting'].includes(permission));
    if (broad.length) return `Broad permissions require explicit user confirmation: ${broad.join(', ')}`;
    return undefined;
  }

  private async smokeExtension(project: ProjectRecord, onEvent: GateOptions['onEvent']): Promise<string | undefined> {
    const id = crypto.randomUUID();
    const output = join(project.path, '.output/chrome-mv3');
    const screenshot = join(project.path, '.kiln/smoke.png');
    const profile = join(tmpdir(), `kiln-extension-smoke-${crypto.randomUUID()}`);
    await rm(screenshot, { force: true });
    onEvent(event('gate', 'Extension service worker and popup smoke test', 'running', undefined, id));
    try {
      const manifest = await readJson<any>(join(output, 'manifest.json'), {});
      const context = await chromium.launchPersistentContext(profile, {
        headless: false,
        args: [`--disable-extensions-except=${output}`, `--load-extension=${output}`, '--no-first-run'],
      });
      try {
        let worker = context.serviceWorkers()[0];
        worker ??= await context.waitForEvent('serviceworker', { timeout: 20_000 });
        const extensionId = new URL(worker.url()).host;
        const popupPath = manifest.action?.default_popup ?? 'popup.html';
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`chrome-extension://${extensionId}/${popupPath}`);
        await page.locator('body').waitFor({ state: 'visible' });
        await page.screenshot({ path: screenshot });
        if (errors.length) throw new Error(errors.join('\n'));
      } finally {
        await context.close();
      }
      onEvent(event('gate', 'Extension service worker and popup smoke test', 'ok', undefined, id));
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent(event('gate', 'Extension service worker and popup smoke test', 'fail', message, id));
      return message;
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }

  private async checks(project: ProjectRecord, onEvent: GateOptions['onEvent']): Promise<string[]> {
    const errors: string[] = [];
    const typecheck = await command(project, ['npm', 'run', 'typecheck'], 'npm run typecheck', onEvent);
    if (!typecheck.ok) errors.push(typecheck.output);
    const lint = await command(project, ['npm', 'run', 'lint', '--', '--fix'], 'npm run lint --fix', onEvent);
    if (!lint.ok) errors.push(lint.output);
    const build = await command(project, ['npm', 'run', 'build'], project.type === 'extension' ? 'WXT build smoke test' : 'Electron build smoke test', onEvent);
    if (!build.ok) errors.push(build.output);
    const manifestError = build.ok ? await this.validateManifest(project) : undefined;
    if (manifestError) {
      errors.push(manifestError);
      onEvent(event('gate', 'Manifest validation', 'fail', manifestError));
    } else if (project.type === 'extension' && build.ok) {
      onEvent(event('gate', 'Manifest validation', 'ok'));
      const smokeError = await this.smokeExtension(project, onEvent);
      if (smokeError) errors.push(`Extension smoke test failed:\n${smokeError}`);
    }
    if (project.type === 'mac-app' && build.ok) {
      const id = crypto.randomUUID();
      const screenshot = join(project.path, '.kiln/smoke.png');
      await rm(screenshot, { force: true });
      onEvent(event('gate', 'App launch and screenshot smoke test', 'running', undefined, id));
      const smoke = await runCommand(join(project.path, 'node_modules/.bin/electron'), ['.'], {
        cwd: project.path,
        timeoutMs: 45_000,
        env: { KILN_SMOKE_SCREENSHOT: screenshot, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined },
      });
      const ok = smoke.code === 0 && await pathExists(screenshot);
      onEvent(event('gate', 'App launch and screenshot smoke test', ok ? 'ok' : 'fail', `${smoke.stdout}${smoke.stderr}`.trim(), id));
      if (!ok) errors.push(`Generated app smoke test failed:\n${smoke.stderr || smoke.stdout}`);
    }
    return errors.filter(Boolean);
  }

  async run(options: GateOptions): Promise<GateResult> {
    const { project, onEvent } = options;
    await this.projects.git(project.path, ['reset', '--soft', options.baseCommit]);
    await this.projects.git(project.path, ['add', '-A']);
    await this.projects.git(project.path, ['commit', '--allow-empty', '-m', `Kiln checkpoint: ${options.message.slice(0, 72)}`]);

    const policyErrors = [
      ...(await this.sanitizeLocked(project, onEvent)),
      ...(await this.auditDependencies(project, onEvent)).map((name) => `Dependency ${name} is not allowlisted.`),
    ];
    let errors = [...policyErrors, ...(await this.checks(project, onEvent))];
    for (let attempt = 1; errors.length && attempt <= 3; attempt += 1) {
      onEvent(event('gate', `Automatic repair ${attempt}/3`, 'running', errors.join('\n\n')));
      await options.repair(errors.join('\n\n'));
      await this.sanitizeLocked(project, onEvent);
      await this.auditDependencies(project, onEvent);
      errors = await this.checks(project, onEvent);
    }
    await this.projects.git(project.path, ['add', '-A']);
    await this.projects.git(project.path, ['commit', '--amend', '--no-edit']);
    if (errors.length) return { ok: false, error: errors.join('\n\n') };

    const next = project.latestVersion + 1;
    const tag = `v${next}`;
    await this.projects.git(project.path, ['tag', tag]);
    const smoke = join(project.path, '.kiln/smoke.png');
    if (await pathExists(smoke)) {
      const screenshots = join(project.path, '.kiln/screenshots');
      await mkdir(screenshots, { recursive: true });
      await copyFile(smoke, join(screenshots, `${tag}.png`));
    }
    return { ok: true, tag };
  }
}

export function lockedFilesFor(type: ProjectType): string[] {
  return type === 'mac-app'
    ? ['electron.vite.config.ts', 'electron-builder.yml', 'src/preload/index.ts']
    : ['wxt.config.ts', 'tsconfig.json'];
}
