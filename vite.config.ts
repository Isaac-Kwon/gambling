import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// GitHub Pages serves 404.html for unknown paths: reuse the lobby so deep links fall back to it.
function copy404(): Plugin {
  let outDir = 'dist';
  return {
    name: 'copy-404',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const src = resolve(outDir, 'index.html');
      if (existsSync(src)) copyFileSync(src, resolve(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  // Local dev: "/". CI sets BASE_PATH=/gambling/.
  base: process.env.BASE_PATH ?? '/',
  resolve: {
    alias: {
      '@shared': r('./shared'),
      '@i18n': r('./i18n'),
    },
  },
  build: {
    target: 'es2020',
    manifest: true, // later bundle-purity check walks dist/.vite/manifest.json from the root entry
    rollupOptions: {
      input: {
        main: r('./index.html'),
        understanding: r('./understanding/index.html'),
      },
    },
  },
  plugins: [
    copy404(),
    // PWA: vite-plugin-pwa is wired in Phase 6.
  ],
});
