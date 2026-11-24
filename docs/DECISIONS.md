# Decisions

- 2026-11-24 [url] Site deployed at https://isaack.dev/gambling/ (GitHub Pages project site, repo Isaac-Kwon/gambling) — custom domain comes from the user site, so no CNAME here
- 2026-11-24 [url] Lobby lives at site root (`/index.html` loads `/gambling/src/main.ts`), second page at `/understanding/` — user decision, replaces the redirect default
- 2026-11-24 [build] Vite `base` read from env `BASE_PATH` (default `/`, CI sets `/gambling/`) — one config for local dev and Pages
- 2026-11-24 [build] dist/404.html is a copy of dist/index.html (vite plugin) — Pages serves it for unknown paths, so deep links land on the lobby
- 2026-11-24 [build] `build.manifest: true`, target es2020 — later bundle-purity check walks dist/.vite/manifest.json
- 2026-11-24 [test] Tests are colocated `*.test.ts`, environment node — DOM env added only when a test needs it
- 2026-11-24 [i18n] Sync JSON dictionaries, `makeT` per-page modules (i18n.gambling / i18n.understanding, so each bundle only holds its own strings) fall back to ko on empty/missing — en/it hold keys only in MVP; test enforces key parity
- 2026-11-24 [deps] vite 8.3.8, typescript 7.0.2, vitest 5.1.1, vite-plugin-pwa 2.0.0 (peer supports vite ^8), pixi.js 8.23.0, uplot 1.6.32, tsx 4.23.15 — current releases; vite 8 is within vite-plugin-pwa peer range
- 2026-11-24 [ci] Actions: checkout@v6, setup-node@v6, upload-pages-artifact@v5, deploy-pages@v5 — rtp and check:bundle steps left as comments until those scripts exist
