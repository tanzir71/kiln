import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { runCommand } from '../../src/main/util/process';
import { selectGlyph } from './glyphs';

const PALETTES: Array<[string, string]> = [
  ['#ff8a5b', '#d83367'], ['#ffbe55', '#e85d2a'], ['#a78bfa', '#6d48d7'],
  ['#58a6ff', '#3156d3'], ['#45d6c7', '#168c85'], ['#7bd66f', '#268a52'],
  ['#ff77b7', '#a93f91'], ['#7d8cff', '#4738b7'], ['#68d4ff', '#2278b8'],
  ['#d9a66b', '#8a4f29'], ['#ff6b6b', '#a8203a'], ['#78c6a3', '#2d6a5f'],
];

export interface ComposeIconOptions {
  name: string;
  description?: string;
  target: 'mac' | 'extension';
  outDir: string;
  palette?: [string, string];
}

function hashIndex(value: string, length: number): number {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % length;
}

function svg(options: ComposeIconOptions): string {
  const glyph = selectGlyph(`${options.name} ${options.description ?? ''}`);
  const [from, to] = options.palette ?? PALETTES[hashIndex(options.name, PALETTES.length)];
  const radius = options.target === 'mac' ? 220 : 180;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="14" flood-opacity=".24"/></filter>
    </defs>
    <rect x="56" y="56" width="912" height="912" rx="${radius}" fill="url(#bg)"/>
    <g transform="translate(230 230) scale(23.5)" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#shadow)">${glyph.paths}</g>
  </svg>`;
}

export async function composeIcon(options: ComposeIconOptions): Promise<{ previewPng: string; icns?: string }> {
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const source = Buffer.from(svg(options));
  if (options.target === 'extension') {
    const iconDir = join(outDir, 'icon');
    await mkdir(iconDir, { recursive: true });
    for (const size of [16, 32, 48, 96, 128]) {
      await sharp(source).resize(size, size).png().toFile(join(iconDir, `${size}.png`));
    }
    return { previewPng: join(iconDir, '128.png') };
  }

  const previewPng = join(outDir, 'icon.png');
  await sharp(source).png().toFile(previewPng);
  const iconset = join(outDir, 'icon.iconset');
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  const variants: Array<[number, string]> = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'], [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'], [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'], [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, name] of variants) await sharp(source).resize(size, size).png().toFile(join(iconset, name));
  const icns = join(outDir, 'icon.icns');
  const result = await runCommand('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icns]);
  if (result.code !== 0) throw new Error(`iconutil failed: ${result.stderr}`);
  await rm(iconset, { recursive: true, force: true });
  return { previewPng, icns };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  const name = value('--name');
  const target = value('--target') as ComposeIconOptions['target'];
  const outDir = value('--out');
  if (!name || !outDir || !['mac', 'extension'].includes(target)) {
    throw new Error('Usage: compose.ts --name <name> --target <mac|extension> --out <directory>');
  }
  await composeIcon({ name, target, outDir });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main();
}
