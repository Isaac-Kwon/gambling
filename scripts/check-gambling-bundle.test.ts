import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  collectGraph,
  computeBudget,
  defaultRules,
  filesOf,
  findBoundaryViolations,
  findEntry,
  pixiInfo,
  scanSourceBoundaries,
  scanText,
  staticClosure,
  type Manifest,
} from './check-gambling-bundle';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

const hits = (text: string, over = {}) => scanText(text, defaultRules(over)).violations.map((v) => v.rule);

describe('scanText forbidden words', () => {
  const plain = [
    '교육', '중독', '하우스 엣지', 'house edge', 'near-miss', '니어미스', '바다이야기', '하우스엣지', 'houseEdge',
    'near miss', 'nearMiss', '도박', '예방', '치유', '오개념', '기댓값', '퀴즈', '해설', '실험', 'educat', 'addict',
    'helpline', 'fallacy', 'disguised',
  ];
  for (const w of plain) {
    it(`catches ${w}`, () => {
      expect(hits(`const a = "x ${w} y";`).length).toBeGreaterThan(0);
    });
  }
  it('is case-insensitive for plain words', () => {
    expect(hits('HOUSE EDGE')).toContain('house edge');
    expect(hits('Near-Miss')).toContain('near-miss');
    expect(hits('HOUSEEDGE')).toContain('houseEdge');
    expect(hits('Education')).toContain('educat');
    expect(hits('The Gambler\'s FALLACY')).toContain('fallacy');
  });
  it('passes clean text', () => {
    expect(hits('const spin = () => dispVar + celebrate; "SPIN" "CASH OUT"')).toEqual([]);
  });
  it('LDW and RTP are case-sensitive with word boundaries', () => {
    expect(hits('x LDW y')).toContain('LDW');
    expect(hits('"LDW"')).toContain('LDW');
    expect(hits('ldw')).toEqual([]);
    expect(hits('Ldw')).toEqual([]);
    expect(hits('BALDWIN')).toEqual([]);
    expect(hits('LDWx')).toEqual([]);
    expect(hits('(RTP)')).toContain('RTP');
    expect(hits('rtp')).toEqual([]);
    expect(hits('STRTP RTPS')).toEqual([]);
  });
  it('1336 only when standalone', () => {
    expect(hits('x 1336 y')).toContain('1336');
    expect(hits('"1336"')).toContain('1336');
    expect(hits('213360')).toEqual([]);
    expect(hits('11336')).toEqual([]);
    expect(hits('13365')).toEqual([]);
    expect(hits('0.1336')).toEqual([]);
    expect(hits('1336.5')).toEqual([]);
    expect(hits('12.1336')).toEqual([]);
  });
  it('reports line numbers', () => {
    const v = scanText('a\nb\n도박', defaultRules()).violations[0];
    expect(v.line).toBe(3);
  });
});

describe('understanding special rule', () => {
  it('count mode: followed by "/" passes, otherwise fails, and counts', () => {
    const ok = scanText('const DETAIL_PATH = "understanding/";', defaultRules());
    expect(ok.violations).toEqual([]);
    expect(ok.understandingCount).toBe(1);
    expect(hits('const x = "understanding";')).toContain('understanding (not followed by "/")');
    expect(hits('understandingFoo')).toContain('understanding (not followed by "/")');
    expect(hits('Understanding/')).toEqual([]);
    expect(scanText('understanding/ understanding/', defaultRules()).understandingCount).toBe(2);
  });
  it('zero mode: any occurrence fails (HTML / manifest)', () => {
    expect(hits('<a href="understanding/">', { understanding: 'zero' })).toContain('understanding');
  });
  it('exempt mode skips it (sw.js / workbox)', () => {
    const r = scanText('"understanding/index.html" understanding', defaultRules({ understanding: 'exempt' }));
    expect(r.violations).toEqual([]);
    expect(r.understandingCount).toBe(0);
  });
  it('exempt mode still checks other words', () => {
    expect(hits('도박 understanding/', { understanding: 'exempt' })).toEqual(['도박']);
  });
});

describe('URL allow-list and forbidden APIs', () => {
  it('allows w3.org namespaces and the pixijs.com greeting', () => {
    expect(hits('xmlns="http://www.w3.org/2000/svg"')).toEqual([]);
    expect(hits('"http://www.pixijs.com/"')).toEqual([]);
  });
  it('rejects other URLs', () => {
    expect(hits('fetch("https://example.com/x")')).toEqual(['external URL']);
    expect(hits('"http://www.w3.org.evil.com/"')).toEqual(['external URL']);
    expect(hits('"http://pixijs.com/"')).toEqual(['external URL']);
    expect(hits('https://www.w3.org/')).toEqual(['external URL']);
  });
  it('allowHttps accepts https source links but not http', () => {
    expect(hits('https://example.org/a', { allowHttps: true })).toEqual([]);
    expect(hits('http://example.org/a', { allowHttps: true })).toEqual(['external URL']);
  });
  for (const api of ['Notification', 'PushManager', 'setAppBadge', 'periodicSync', 'storage.persist']) {
    it(`flags ${api} when forbiddenApis is on`, () => {
      expect(hits(`navigator.${api}()`, { forbiddenApis: true })).toContain('forbidden API');
      expect(hits(`navigator.${api}()`)).toEqual([]);
    });
  }
});

// ---- graph

const fake: Manifest = {
  'index.html': { file: 'assets/main.js', src: 'index.html', isEntry: true, imports: ['_shared.js', '_util.js'], dynamicImports: ['gambling/games/slot.ts', 'gambling/fx/gl/stage.ts'], css: ['assets/main.css'], assets: ['assets/font.woff2'] },
  'understanding/index.html': { file: 'assets/u.js', src: 'understanding/index.html', isEntry: true, imports: ['_shared.js', '_uonly.js'] },
  '_shared.js': { file: 'assets/c-1.js', imports: ['_util.js'] },
  '_util.js': { file: 'assets/c-2.js' },
  '_uonly.js': { file: 'assets/c-3.js' },
  'gambling/games/slot.ts': { file: 'assets/c-4.js', src: 'gambling/games/slot.ts', isDynamicEntry: true, imports: ['_shared.js', '_gameonly.js'], css: ['assets/slot.css'] },
  '_gameonly.js': { file: 'assets/c-5.js' },
  'gambling/fx/gl/stage.ts': { file: 'assets/c-6.js', src: 'gambling/fx/gl/stage.ts', isDynamicEntry: true, imports: ['_util.js', '_pixi.js'] },
  '_pixi.js': { file: 'assets/c-7.js' },
};

describe('manifest graph walk', () => {
  it('finds the lobby entry by src, not file name', () => {
    expect(findEntry(fake)).toBe('index.html');
    expect(findEntry(fake, 'understanding/index.html')).toBe('understanding/index.html');
    expect(findEntry({ a: { file: 'x.js' } })).toBeUndefined();
  });
  it('static closure excludes dynamic imports, handles shared chunks once', () => {
    expect([...staticClosure(fake, 'index.html')].sort()).toEqual(['_shared.js', '_util.js', 'index.html']);
  });
  it('collectGraph splits static and dynamic', () => {
    const g = collectGraph(fake, 'index.html');
    expect([...g.dynamicKeys].sort()).toEqual(['_gameonly.js', '_pixi.js', 'gambling/fx/gl/stage.ts', 'gambling/games/slot.ts']);
    expect(g.allKeys.size).toBe(g.staticKeys.size + g.dynamicKeys.size);
    expect(g.allKeys.has('_uonly.js')).toBe(false);
  });
  it('survives cycles and missing keys', () => {
    const m: Manifest = { e: { file: 'e.js', isEntry: true, src: 'index.html', imports: ['a', 'missing'] }, a: { file: 'a.js', imports: ['e'], dynamicImports: ['e'] } };
    expect([...collectGraph(m, 'e').allKeys].sort()).toEqual(['a', 'e']);
  });
  it('filesOf gathers js, css, assets', () => {
    const f = filesOf(fake, collectGraph(fake, 'index.html').allKeys);
    expect(f.js).toContain('assets/c-7.js');
    expect(f.css.sort()).toEqual(['assets/main.css', 'assets/slot.css']);
    expect(f.assets).toEqual(['assets/font.woff2']);
  });
});

describe('budget and Pixi', () => {
  const blobs: Record<string, string> = {};
  for (let i = 1; i <= 7; i++) blobs[`assets/c-${i}.js`] = `// chunk ${i}\n` + 'x'.repeat(i * 100);
  blobs['assets/main.js'] = 'main';
  const read = (f: string) => Buffer.from(blobs[f] ?? '');
  const gz = (f: string) => gzipSync(read(f), { level: 9 }).length;

  it('sums gzip of the static closure JS only', () => {
    const b = computeBudget(fake, 'index.html', read, 250);
    expect(b.files.map((f) => f.file).sort()).toEqual(['assets/c-1.js', 'assets/c-2.js', 'assets/main.js']);
    expect(b.total).toBe(gz('assets/c-1.js') + gz('assets/c-2.js') + gz('assets/main.js'));
    expect(b.ok).toBe(true);
  });
  it('fails over budget', () => {
    expect(computeBudget(fake, 'index.html', read, 0.01).ok).toBe(false);
  });
  it('Pixi chunk = stage closure minus entry closure', () => {
    const p = pixiInfo(fake, 'index.html', read);
    expect(p.state).toBe('present');
    expect(p.files.sort()).toEqual(['assets/c-6.js', 'assets/c-7.js']);
    expect(p.problems).toEqual([]);
    expect(p.warn).toBe(false);
  });
  it('Pixi absent is "not built", failing only when the stage source exists', () => {
    const m: Manifest = { 'index.html': fake['index.html'] };
    expect(pixiInfo(m, 'index.html', read).state).toBe('not built');
    expect(pixiInfo(m, 'index.html', read).problems).toEqual([]);
    expect(pixiInfo(m, 'index.html', read, true).problems.length).toBe(1);
  });
  it('flags stage in the static closure or not a dynamic entry', () => {
    const bad: Manifest = { ...fake, 'index.html': { ...fake['index.html'], imports: ['_shared.js', 'gambling/fx/gl/stage.ts'] } };
    expect(pixiInfo(bad, 'index.html', read).problems.join()).toMatch(/static closure/);
    const bad2: Manifest = { ...fake, 'gambling/fx/gl/stage.ts': { ...fake['gambling/fx/gl/stage.ts'], isDynamicEntry: false } };
    expect(pixiInfo(bad2, 'index.html', read).problems.join()).toMatch(/not a dynamic entry/);
  });
  it('warns above 110KB gzip', () => {
    const noise = randomBytes(200 * 1024);
    const p = pixiInfo(fake, 'index.html', (f) => (f === 'assets/c-7.js' ? noise : read(f)));
    expect(p.warn).toBe(true);
  });
});

// ---- import boundaries

const src = (path: string, text: string) => ({ path, text });

describe('import boundaries (fake sources)', () => {
  it('gambling must not import understanding', () => {
    const v = findBoundaryViolations([
      src('gambling/src/a.ts', "import x from '../../understanding/src/main';"),
      src('gambling/src/b.ts', "import { t } from '@shared/i18n.understanding';"),
      src('gambling/src/c.ts', "const m = import('@i18n/understanding/app.ko.json');"),
      src('gambling/src/d.ts', "import ko from '../../i18n/understanding.ko.json';"),
      src('gambling/src/e.ts', "const m = import.meta.glob('@i18n/understanding/*.ko.json', { eager: true });"),
    ]);
    expect(v.map((x) => x.file).sort()).toEqual(['gambling/src/a.ts', 'gambling/src/b.ts', 'gambling/src/c.ts', 'gambling/src/d.ts', 'gambling/src/e.ts']);
  });
  it('gambling may import shared and i18n/gambling', () => {
    expect(findBoundaryViolations([
      src('gambling/src/a.ts', "import { rng } from '@shared/rng';\nimport ko from '@i18n/gambling/app.ko.json';\nimport './x';\nexport * from '../fx/types';"),
    ])).toEqual([]);
  });
  it('shared must not import gambling or understanding', () => {
    const v = findBoundaryViolations([
      src('shared/a.ts', "import x from '../gambling/src/types';"),
      src('shared/rules/b.ts', "export { y } from '../../understanding/src/main';"),
      src('shared/i18n.gambling.ts', "import ko from '@i18n/gambling/app.ko.json';"),
      src('shared/i18n.understanding.ts', "import ko from '@i18n/understanding/app.ko.json';"),
    ]);
    expect(v.map((x) => x.file)).toEqual(['shared/a.ts', 'shared/rules/b.ts']);
  });
  it('understanding must not import gambling', () => {
    const v = findBoundaryViolations([
      src('understanding/src/a.ts', "import x from '../../gambling/src/types';"),
      src('understanding/src/b.ts', "import ko from '@i18n/gambling/app.ko.json';"),
      src('understanding/src/c.ts', "import { t } from '@shared/i18n.understanding';\nconst s = import('./demo/session.json');"),
    ]);
    expect(v.map((x) => x.file)).toEqual(['understanding/src/a.ts', 'understanding/src/b.ts']);
  });
  it('ignores test files and bare packages', () => {
    expect(findBoundaryViolations([
      src('shared/a.test.ts', "import x from '../gambling/src/types';"),
      src('gambling/a.ts', "import { Application } from 'pixi.js';"),
    ])).toEqual([]);
  });
});

describe('import boundaries (real repo)', () => {
  it('has no violations', () => {
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    expect(scanSourceBoundaries(root)).toEqual([]);
  });
});
