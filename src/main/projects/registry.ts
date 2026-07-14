import { randomUUID } from 'node:crypto';
import { cp, link, mkdir, readlink, readdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { shell } from 'electron';
import type { FileNode, Project, Version } from '../../../ui/src/types';
import { composeIcon } from '../../../harness/icons/compose';
import type { SettingsStore } from '../settings/store';
import { ensureDir, expandHome, pathExists, readJson, safePath, sha256File, slugify, writeJson } from '../util/files';
import { runCommand } from '../util/process';

export interface ProjectRecord extends Project {
  path: string;
  slug: string;
  sessionId?: string;
  currentTag?: string;
}

const META = '.kiln/project.json';
const LOCKED: Record<Project['type'], string[]> = {
  'mac-app': ['electron.vite.config.ts', 'electron-builder.yml', 'src/preload/index.ts'],
  extension: ['wxt.config.ts', 'tsconfig.json'],
};

function publicProject(record: ProjectRecord): Project {
  const { path: _path, slug: _slug, sessionId: _session, currentTag: _tag, ...project } = record;
  return project;
}

async function dataUrl(path: string): Promise<string> {
  return `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
}

async function hardlinkTree(source: string, destination: string, sourceRoot = source, destinationRoot = destination): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const item of await readdir(source, { withFileTypes: true })) {
    const from = join(source, item.name);
    const to = join(destination, item.name);
    if (item.isDirectory()) await hardlinkTree(from, to, sourceRoot, destinationRoot);
    else if (item.isSymbolicLink()) {
      const target = await readlink(from);
      const marker = `${process.platform === 'win32' ? '\\' : '/'}node_modules${process.platform === 'win32' ? '\\' : '/'}`;
      const markerAt = target.lastIndexOf(marker);
      const mapped = target.startsWith(sourceRoot)
        ? join(destinationRoot, relative(sourceRoot, target))
        : markerAt >= 0 ? join(destinationRoot, target.slice(markerAt + marker.length)) : target;
      await symlink(target.startsWith('/') ? relative(dirname(to), mapped) : target, to);
    }
    else {
      try { await link(from, to); } catch { await cp(from, to); }
    }
  }
}

export class ProjectRegistry {
  private readonly statuses = new Map<string, Project['status']>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly resourcesRoot: string,
  ) {}

  private async projectsDir(): Promise<string> {
    const path = expandHome((await this.settings.get()).projectsDir);
    await ensureDir(path);
    return await realpath(path);
  }

  private async save(record: ProjectRecord): Promise<void> {
    await writeJson(join(record.path, META), record);
  }

  async listRecords(): Promise<ProjectRecord[]> {
    const root = await this.projectsDir();
    const records: ProjectRecord[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const record = await readJson<ProjectRecord | undefined>(join(root, entry.name, META), undefined);
      if (!record) continue;
      record.path = join(root, entry.name);
      record.status = this.statuses.get(record.id) ?? 'idle';
      records.push(record);
    }
    return records.sort((a, b) => b.lastEditedAt.localeCompare(a.lastEditedAt));
  }

  async list(): Promise<Project[]> {
    return (await this.listRecords()).map(publicProject);
  }

  async get(id: string): Promise<ProjectRecord> {
    const record = (await this.listRecords()).find((project) => project.id === id);
    if (!record) throw new Error(`Project not found: ${id}`);
    return record;
  }

  async create(input: Pick<Project, 'name' | 'type' | 'engine'>): Promise<Project> {
    const root = await this.projectsDir();
    const baseSlug = slugify(input.name);
    let slug = baseSlug;
    let suffix = 2;
    while (await pathExists(join(root, slug))) slug = `${baseSlug}-${suffix++}`;
    const path = join(root, slug);
    const template = join(this.resourcesRoot, 'templates', input.type === 'mac-app' ? 'app-base' : 'ext-base');
    if (!(await pathExists(template))) throw new Error(`Missing project template: ${template}`);
    await cp(template, path, { recursive: true, errorOnExist: true });
    await this.personalize(path, input.name, slug, input.type);

    const cache = join(expandHome('~/Kiln/cache'), input.type === 'mac-app' ? 'app-base-node_modules' : 'ext-base-node_modules');
    if (await pathExists(cache)) await hardlinkTree(cache, join(path, 'node_modules'));

    const icon = input.type === 'mac-app'
      ? await composeIcon({ name: input.name, target: 'mac', outDir: join(path, 'resources') })
      : await composeIcon({ name: input.name, target: 'extension', outDir: join(path, 'public') });
    const now = new Date().toISOString();
    const record: ProjectRecord = {
      id: randomUUID(), name: input.name, type: input.type, engine: input.engine,
      icon: await dataUrl(icon.previewPng), status: 'idle', latestVersion: 0,
      createdAt: now, lastEditedAt: now, path, slug,
    };
    await ensureDir(join(path, '.kiln'));
    await this.save(record);

    const packageJson = await readJson<any>(join(path, 'package.json'), {});
    await writeJson(join(path, '.kiln/dependencies.json'), {
      dependencies: packageJson.dependencies ?? {},
      devDependencies: packageJson.devDependencies ?? {},
    });
    const locked: Record<string, string> = {};
    for (const file of LOCKED[input.type]) {
      if (await pathExists(join(path, file))) locked[file] = await sha256File(join(path, file));
    }
    await writeJson(join(path, '.kiln/locked.json'), locked);
    await this.git(path, ['init', '-b', 'main']);
    await this.git(path, ['config', 'user.name', 'Kiln']);
    await this.git(path, ['config', 'user.email', 'versions@kiln.local']);
    await this.git(path, ['add', '-A']);
    await this.git(path, ['commit', '-m', 'Kiln: scaffold project']);
    await this.git(path, ['tag', 'kiln-base']);
    return publicProject(record);
  }

  private async personalize(path: string, name: string, slug: string, type: Project['type']): Promise<void> {
    const replacements: Record<string, string> = {
      '__APP_NAME__': name,
      '__APP_SLUG__': slug,
      '__APP_ID__': `com.kiln.${slug.replace(/-/g, '.')}`,
    };
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const target = join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else {
          const buffer = await readFile(target);
          if (buffer.includes(0)) continue;
          let content = buffer.toString('utf8');
          for (const [token, replacement] of Object.entries(replacements)) content = content.split(token).join(replacement);
          await writeFile(target, content);
        }
      }
    };
    await visit(path);
    const harnessName = type === 'mac-app' ? 'AGENTS.app.md' : 'AGENTS.extension.md';
    const instructions = await readFile(join(this.resourcesRoot, 'harness', harnessName), 'utf8');
    await writeFile(join(path, 'AGENTS.md'), instructions);
    await writeFile(join(path, 'CLAUDE.md'), instructions);
  }

  async delete(id: string): Promise<void> {
    const record = await this.get(id);
    await shell.trashItem(record.path);
    this.statuses.delete(id);
  }

  async update(id: string, patch: Partial<ProjectRecord>): Promise<Project> {
    const record = await this.get(id);
    const next = { ...record, ...patch, path: record.path };
    if (patch.status) this.statuses.set(id, patch.status);
    await this.save({ ...next, status: 'idle' });
    return { ...publicProject(next), status: this.statuses.get(id) ?? next.status };
  }

  async setStatus(id: string, status: Project['status']): Promise<Project> {
    this.statuses.set(id, status);
    const record = await this.get(id);
    return { ...publicProject(record), status };
  }

  async ensureDependencies(record: ProjectRecord): Promise<void> {
    if (await pathExists(join(record.path, 'node_modules'))) return;
    const result = await runCommand('npm', ['install'], { cwd: record.path, timeoutMs: 10 * 60_000 });
    if (result.code !== 0) throw new Error(`Dependency install failed:\n${result.stderr}`);
    const cache = join(expandHome('~/Kiln/cache'), record.type === 'mac-app' ? 'app-base-node_modules' : 'ext-base-node_modules');
    if (!(await pathExists(cache))) {
      await ensureDir(dirname(cache));
      await hardlinkTree(join(record.path, 'node_modules'), cache);
    }
  }

  async listVersions(id: string): Promise<Version[]> {
    const record = await this.get(id);
    const refs = await this.git(record.path, ['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)\t%(creatordate:iso-strict)\t%(subject)', 'refs/tags/v*']);
    const versions: Version[] = [];
    for (const line of refs.stdout.trim().split('\n').filter(Boolean)) {
      const [tag, ts, message] = line.split('\t');
      const screenshotPath = join(record.path, `.kiln/screenshots/${tag}.png`);
      versions.push({
        tag, ts, message: message || 'Saved version', current: record.currentTag === tag,
        screenshot: await pathExists(screenshotPath) ? await dataUrl(screenshotPath) : undefined,
      });
    }
    return versions;
  }

  async revert(id: string, tag: string): Promise<Project> {
    const record = await this.get(id);
    if (!/^v\d+$/.test(tag)) throw new Error('Invalid version tag');
    const known = (await this.listVersions(id)).some((version) => version.tag === tag);
    if (!known) throw new Error(`Unknown version: ${tag}`);
    await this.git(record.path, ['checkout', tag, '--', '.']);
    await this.git(record.path, ['add', '-A']);
    await this.git(record.path, ['commit', '-m', `Revert to ${tag}`]);
    const nextVersion = record.latestVersion + 1;
    const nextTag = `v${nextVersion}`;
    await this.git(record.path, ['tag', nextTag]);
    return await this.update(id, { latestVersion: nextVersion, currentTag: nextTag, lastEditedAt: new Date().toISOString() });
  }

  async listFiles(id: string): Promise<FileNode[]> {
    const record = await this.get(id);
    const skip = new Set(['.git', '.kiln', 'node_modules', 'out', 'dist', '.output', '.wxt']);
    const walk = async (directory: string): Promise<FileNode[]> => {
      const nodes: FileNode[] = [];
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
        if (skip.has(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const path = relative(record.path, absolute);
        nodes.push(entry.isDirectory()
          ? { name: entry.name, path, kind: 'dir', children: await walk(absolute) }
          : { name: entry.name, path, kind: 'file' });
      }
      return nodes;
    };
    return await walk(record.path);
  }

  async readFile(id: string, path: string): Promise<string> {
    const record = await this.get(id);
    const absolute = safePath(record.path, path);
    if ((await stat(absolute)).size > 1024 * 1024) throw new Error('Files larger than 1 MB are not shown');
    return await readFile(absolute, 'utf8');
  }

  async git(path: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    const result = await runCommand('git', args, { cwd: path, timeoutMs: 120_000 });
    if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr || result.stdout}`);
    return result;
  }
}
