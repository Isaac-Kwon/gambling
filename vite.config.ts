import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Local dev: '/'. CI sets BASE_PATH=/gambling/.
const base = process.env.BASE_PATH ?? '/';

// Workbox ships a console.warn that ends in a bit.ly link. It is never requested, but the bundle check
// forbids external URLs in every shipped file, so the link text is cut from dist/workbox-*.js after generation.
function stripWorkboxLinks(): Plugin {
  let outDir = 'dist';
  return {
    name: 'strip-workbox-links',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        if (!existsSync(outDir)) return;
        for (const n of readdirSync(outDir)) {
          if (!/^workbox-.*\.js$/.test(n)) continue;
          const p = resolve(outDir, n);
          const src = readFileSync(p, 'utf8');
          const out = src.replace(/ Learn more at https:\/\/bit\.ly\/wb-[\w-]+/g, '');
          if (out !== src) writeFileSync(p, out);
        }
      },
    },
  };
}

export default defineConfig({
  base,
  // Pixi is lazy-imported after the gate tap; pre-bundle it so dev mode doesn't 504 on first load.
  optimizeDeps: { include: ['pixi.js'] },
  resolve: {
    alias: {
      '@shared': r('./shared'),
      '@i18n': r('./i18n'),
    },
  },
  build: {
    target: 'es2020',
    manifest: true, // later bundle-purity check walks dist/.vite/manifest.json from the root entry
    sourcemap: false,
    rollupOptions: {
      output: {
        // Shared chunks get opaque names so module names never leak into dist (entries keep theirs).
        chunkFileNames: 'assets/c-[hash].js',
      },
      input: {
        main: r('./index.html'),
        understanding: r('./understanding/index.html'),
      },
    },
  },
  plugins: [
    copy404(),
    // PWA (ARCHITECTURE 1.4): one manifest, precache everything, the new worker applies on the next launch only.
    VitePWA({
      base,
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: base,
        name: 'OROBELLE 오로벨 카지노',
        short_name: '오로벨',
        description: '네온 불빛 아래 펼쳐지는 슬롯, 룰렛, 블랙잭, 크래시. 지금 오로벨에서 잭팟의 주인공이 되세요!',
        start_url: base,
        scope: base,
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'portrait',
        theme_color: '#0B0612',
        background_color: '#0B0612',
        lang: 'ko',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        globIgnores: ['404.html'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/understanding(\/|$)/],
        ignoreURLParametersMatching: [/^(seed|fx|lang|demo|sv)$/],
        skipWaiting: false,
        clientsClaim: false,
        cleanupOutdatedCaches: true,
      },
    }),
    stripWorkboxLinks(),
  ],
});
