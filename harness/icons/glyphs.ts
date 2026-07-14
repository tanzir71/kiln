// A compact, curated subset of Lucide glyph paths (ISC). The index is intentionally
// small in v1; adding another permissively licensed set only requires another entry.
export interface Glyph {
  name: string;
  tags: string[];
  paths: string;
}

export const GLYPHS: Glyph[] = [
  { name: 'hammer', tags: ['build', 'kiln', 'tool', 'maker'], paths: '<path d="m15 12-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9"/><path d="m17.6 15 3.8-3.8"/><path d="m14.1 6.5 3.4-3.4 3.4 3.4-3.4 3.4"/><path d="m9 8 3 3"/>' },
  { name: 'timer', tags: ['timer', 'pomodoro', 'clock', 'focus', 'countdown'], paths: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>' },
  { name: 'flame', tags: ['flame', 'fire', 'kiln', 'heat', 'hot'], paths: '<path d="M12 22c4.4 0 8-3.6 8-8 0-3-2-5.5-4-7.5 0 2.5-1.5 4-3 4.5.5-4-2-7-5-9 .5 4-4 6.5-4 12 0 4.4 3.6 8 8 8Z"/><path d="M8 18c0-2 1.5-3 3-4.5 0 2 1 3 2.5 3.5.5-1 .8-2 .5-3.5 1.5 1.3 2 2.7 2 4.5"/>' },
  { name: 'puzzle', tags: ['extension', 'browser', 'plugin', 'addon'], paths: '<path d="M19.4 13.5a2.7 2.7 0 1 0 0-3h-2.9V7.6a2.7 2.7 0 1 0-3 0v2.9h-3V7.6a2.7 2.7 0 1 0-3 0v2.9H4v3h3.5v3.1a2.7 2.7 0 1 0 3 0v-3.1h3v3.1a2.7 2.7 0 1 0 3 0v-3.1Z"/>' },
  { name: 'image', tags: ['image', 'photo', 'screenshot', 'art'], paths: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>' },
  { name: 'music', tags: ['music', 'audio', 'sound', 'podcast'], paths: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
  { name: 'database', tags: ['database', 'data', 'track', 'storage'], paths: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>' },
  { name: 'sparkles', tags: ['ai', 'magic', 'assistant', 'generate'], paths: '<path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>' },
];

export function selectGlyph(description: string): Glyph {
  const words = description.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let best = GLYPHS[0];
  let score = -1;
  for (const glyph of GLYPHS) {
    const next = glyph.tags.reduce((sum, tag) => sum + (words.includes(tag) ? 3 : description.toLowerCase().includes(tag) ? 1 : 0), 0);
    if (next > score) { best = glyph; score = next; }
  }
  return best;
}
