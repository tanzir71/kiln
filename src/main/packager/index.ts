import { copyFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExportResult } from '../../../ui/src/types';
import type { ProjectRecord } from '../projects/registry';
import type { SettingsStore } from '../settings/store';
import { ensureDir, expandHome, readJson, writeJson } from '../util/files';
import { runCommand } from '../util/process';

function bump(version: string): string {
  const [major = '1', minor = '0', patch = '0'] = version.split('.');
  return `${Number(major)}.${Number(minor)}.${Number(patch.replace(/\D.*$/, '')) + 1}`;
}

export class ProjectPackager {
  constructor(private readonly settings: SettingsStore) {}

  async export(project: ProjectRecord): Promise<ExportResult> {
    if (project.latestVersion < 1) return { ok: false, artifacts: [], error: 'Build at least one version before exporting.' };
    const packagePath = join(project.path, 'package.json');
    const pkg = await readJson<any>(packagePath, {});
    const statePath = join(project.path, '.kiln/export.json');
    const state = await readJson<{ version?: string }>(statePath, {});
    const originalVersion = String(pkg.version ?? '1.0.0');
    pkg.version = bump(state.version ?? originalVersion);
    await writeJson(packagePath, pkg);
    const destination = expandHome('~/Kiln/dist');
    await ensureDir(destination);
    try {
      const result = project.type === 'mac-app'
        ? await this.exportMac(project, destination, pkg.version)
        : await this.exportExtension(project, destination, pkg.version);
      if (result.ok) await writeJson(statePath, { version: pkg.version });
      return result;
    } catch (error) {
      return { ok: false, artifacts: [], error: error instanceof Error ? error.message : String(error) };
    } finally {
      pkg.version = originalVersion;
      await writeJson(packagePath, pkg);
    }
  }

  private async exportMac(project: ProjectRecord, destination: string, version: string): Promise<ExportResult> {
    const settings = await this.settings.get();
    let result;
    if (settings.signingIdentity) {
      const args = [
        'electron-builder', '--mac', 'dmg', 'zip', '--arm64',
        `--config.mac.identity=${settings.signingIdentity}`,
        '--config.mac.hardenedRuntime=true',
        '--config.mac.entitlements=build/entitlements.mac.plist',
      ];
      if (settings.notarize) args.push('--config.afterSign=build/notarize.cjs');
      const build = await runCommand('npm', ['run', 'build'], { cwd: project.path, timeoutMs: 10 * 60_000 });
      if (build.code !== 0) throw new Error(build.stderr || build.stdout);
      result = await runCommand('npx', args, { cwd: project.path, timeoutMs: 20 * 60_000 });
    } else {
      result = await runCommand('npm', ['run', 'dist'], { cwd: project.path, timeoutMs: 20 * 60_000, env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
    }
    if (result.code !== 0) throw new Error(`DMG export failed:\n${result.stderr || result.stdout}`);
    const names = (await readdir(join(project.path, 'dist'))).filter((name) => name.endsWith('.dmg'));
    if (!names.length) throw new Error('electron-builder completed without producing a DMG');
    const dmg = names[0];
    const artifact = join(destination, `${project.slug}-${version}.dmg`);
    await copyFile(join(project.path, 'dist', dmg), artifact);
    const readme = join(destination, `${project.slug}-${version}-README-INSTALL.txt`);
    await writeFile(readme,
      `${project.name} ${version}\n\nOpen the DMG and drag ${project.name} to Applications.\n\nThis export is ad-hoc signed. On another Mac, first launch may require right-clicking the app and choosing Open. If macOS still blocks it, run: xattr -d com.apple.quarantine "/Applications/${project.name}.app"\n`,
    );
    return { ok: true, artifacts: [artifact, readme] };
  }

  private async exportExtension(project: ProjectRecord, destination: string, version: string): Promise<ExportResult> {
    const chrome = await runCommand('npm', ['run', 'zip'], { cwd: project.path, timeoutMs: 10 * 60_000 });
    if (chrome.code !== 0) throw new Error(`Chrome ZIP export failed:\n${chrome.stderr || chrome.stdout}`);
    const firefox = await runCommand('npm', ['run', 'zip:firefox'], { cwd: project.path, timeoutMs: 10 * 60_000 });
    if (firefox.code !== 0) throw new Error(`Firefox ZIP export failed:\n${firefox.stderr || firefox.stdout}`);
    const names = (await readdir(join(project.path, '.output'))).filter((name) => name.endsWith('.zip'));
    if (!names.some((name) => /chrome/.test(name)) || !names.some((name) => /firefox/.test(name))) {
      throw new Error('WXT did not produce both Chrome and Firefox ZIPs');
    }
    const artifacts: string[] = [];
    for (const kind of ['chrome', 'firefox', 'sources'] as const) {
      const source = names.find((name) => name.includes(kind) && (kind !== 'firefox' || !name.includes('sources')));
      if (!source) continue;
      const output = join(destination, `${project.slug}-${version}-${kind}.zip`);
      await copyFile(join(project.path, '.output', source), output);
      artifacts.push(output);
    }
    const readme = join(destination, `${project.slug}-${version}-README-INSTALL.txt`);
    await writeFile(readme,
      `${project.name} ${version}\n\nChrome / Edge (unpacked): unzip the Chrome artifact, open chrome://extensions, enable Developer mode, choose Load unpacked, and select the extracted folder.\n\nFirefox (temporary test): open about:debugging#/runtime/this-firefox, choose Load Temporary Add-on, and select manifest.json from the extracted Firefox artifact.\n\nStore submission: Chrome Web Store requires a one-time developer registration fee; Mozilla Add-ons registration is free. The Firefox sources ZIP is included for AMO review.\n`,
    );
    return { ok: true, artifacts: [...artifacts, readme] };
  }
}
