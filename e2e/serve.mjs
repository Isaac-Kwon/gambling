// E2E server: BASE_PATH=/gambling/ build into dist-e2e (never touches dist/), then `vite preview` on it.
// This folder is Dropbox-synced and Dropbox sometimes refuses deletes (EPERM): then the build goes to the OS temp dir.
import { rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { build, preview } from 'vite';

process.env.BASE_PATH = '/gambling/';
const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.E2E_PORT ?? 4173);

function freshDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    return true;
  } catch {
    return false;
  }
}

let outDir = resolve(root, 'dist-e2e');
const reuse = process.env.E2E_REUSE_BUILD && existsSync(outDir);
if (!reuse && !freshDir(outDir)) {
  outDir = join(tmpdir(), 'gambling-e2e-dist');
  if (!freshDir(outDir)) throw new Error(`cannot clear ${outDir}`);
  console.warn(`[e2e] dist-e2e is locked, building into ${outDir}`);
}
if (!reuse) await build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: false } });

const server = await preview({ root, logLevel: 'warn', build: { outDir }, preview: { port, strictPort: true, host: '127.0.0.1' } });
server.printUrls();
