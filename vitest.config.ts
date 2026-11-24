import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@shared': r('./shared'), '@i18n': r('./i18n') } },
  test: {
    environment: 'node', // add jsdom/happy-dom only when a later test needs a DOM
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
