import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ProjectRecord } from '../projects/registry';

const RECIPES: Array<{ pattern: RegExp; file: string }> = [
  { pattern: /video|audio|ffmpeg|convert media/i, file: 'media.md' },
  { pattern: /transcrib|speech.to.text|whisper/i, file: 'transcription.md' },
  { pattern: /image|photo|thumbnail|resize/i, file: 'images.md' },
  { pattern: /database|sqlite|track|history|records/i, file: 'data.md' },
  { pattern: /spreadsheet|excel|xlsx|csv/i, file: 'spreadsheets.md' },
  { pattern: /pdf/i, file: 'pdf.md' },
  { pattern: /ocr|recognize text/i, file: 'ocr.md' },
  { pattern: /menu bar|menubar|tray/i, file: 'tray.md' },
  { pattern: /screen record|camera|microphone|accessibility|permission/i, file: 'permissions.md' },
  { pattern: /markdown/i, file: 'markdown.md' },
  { pattern: /highlight|overlay|modify.*page|content script/i, file: 'ext-page-ui.md' },
  { pattern: /storage|setting|preference|save/i, file: 'ext-storage.md' },
  { pattern: /context menu|background|periodic|alarm|notification/i, file: 'ext-background.md' },
  { pattern: /api|request|network|intercept/i, file: 'ext-network.md' },
];

async function tree(root: string): Promise<string> {
  const result: string[] = [];
  const skip = new Set(['.git', '.kiln', 'node_modules', 'out', 'dist', '.output', '.wxt']);
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 4 || result.length > 180) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const path = join(directory, entry.name);
      result.push(`${entry.isDirectory() ? 'd' : 'f'} ${relative(root, path)}`);
      if (entry.isDirectory()) await visit(path, depth + 1);
    }
  };
  await visit(root, 0);
  return result.join('\n');
}

export async function composePrompt(
  project: ProjectRecord,
  userPrompt: string,
  resourcesRoot: string,
  lastError?: string,
): Promise<string> {
  const recipes = RECIPES.filter((recipe) => recipe.pattern.test(userPrompt));
  const recipeText = await Promise.all(recipes.map(async (recipe) =>
    `## Capability recipe: ${recipe.file}\n${await readFile(join(resourcesRoot, 'harness/capabilities', recipe.file), 'utf8')}`));
  return [
    `# User request\n${userPrompt}`,
    recipeText.join('\n\n'),
    `# Current ${project.type === 'mac-app' ? 'Mac app' : 'browser extension'} file tree\n${await tree(project.path)}`,
    lastError ? `# Previous validation errors to fix\n${lastError}` : '',
    '# Completion contract\nImplement the request completely in this existing template. Do not make git commits. Do not edit `.kiln/`. Finish by running `npm run typecheck` and `npm run lint`, and fix all errors before replying.',
  ].filter(Boolean).join('\n\n');
}
