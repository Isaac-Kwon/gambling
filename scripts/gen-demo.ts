// Demo session generator CLI (ARCHITECTURE 10.4).
//   tsx scripts/gen-demo.ts            writes understanding/src/demo/session.json
//   tsx scripts/gen-demo.ts --check    regenerates in memory, exits 1 when the committed file differs
//
// The game modules import .css and use import.meta.glob (i18n), which plain node cannot load, so the generator
// library (gen-demo-lib.ts) is loaded through Vite's SSR module loader, the same transform pipeline as the tests.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const server = await createServer({
    root, configFile: false, logLevel: "silent", appType: "custom", optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: { alias: { "@shared": resolve(root, "shared"), "@i18n": resolve(root, "i18n") } },
  });
  let text: string, path: string;
  try {
    const lib = (await server.ssrLoadModule("/scripts/gen-demo-lib.ts")) as typeof import("./gen-demo-lib");
    text = lib.serialize(await lib.generateDemo());
    path = lib.DEMO_PATH;
  } finally {
    await server.close();
  }
  if (process.argv.includes("--check")) {
    const have = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (have !== text) {
      console.error(`gen-demo: ${path} is stale or missing. Run \`npm run gen:demo\` and commit the result.`);
      process.exit(1);
    }
    console.log("gen-demo: demo session is up to date");
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`gen-demo: wrote ${path} (${(text.length / 1024).toFixed(0)} KiB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
