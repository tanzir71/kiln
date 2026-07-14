import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'harness/**/*.test.ts', 'e2e/**/*.test.ts'],
    exclude: ['node_modules/**', 'out/**', 'release/**', 'templates/**', 'ui/**'],
  },
});
