import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateSigningIdentity } from '.';

describe('generated Mac app signing', () => {
  it('keeps the template on explicit ad-hoc signing', async () => {
    const config = await readFile('templates/app-base/electron-builder.yml', 'utf8');
    expect(config).toMatch(/^\s*identity:\s*"-"\s*$/m);
    expect(config).toMatch(/^\s*hardenedRuntime:\s*false\s*$/m);
  });

  it('accepts ad-hoc or Developer ID signing only', () => {
    expect(() => validateSigningIdentity()).not.toThrow();
    expect(() => validateSigningIdentity('Developer ID Application: Example (TEAM123)')).not.toThrow();
    expect(() => validateSigningIdentity('Apple Development: Example (TEAM123)')).toThrow(/Developer ID Application/);
  });
});
