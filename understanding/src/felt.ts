/**
 * Intro answers ("how long did it feel", "how much did it feel you won/lost"), kept on this device only.
 * One record, keyed by the session (seed + start time), so a new session asks again.
 * Storage may be blocked or missing (node tests): every access is try/catch with an in-memory fallback.
 */
export interface FeltRecord {
  key: string;
  /** Felt minutes played; null when not answered. */
  minutes: number | null;
  /** Felt result in credits (+ won / − lost); null when not answered. */
  net: number | null;
  /** The reader chose to go on without answering. */
  skipped: boolean;
}

export const FELT_STORAGE_KEY = 'eg.u.felt';

export const feltKey = (s: { seed: string; startedAt: number }): string => `${s.seed}@${s.startedAt}`;

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function parseFelt(raw: string | null | undefined, key: string): FeltRecord | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<FeltRecord> | null;
    if (!o || typeof o !== 'object' || o.key !== key) return null;
    return { key, minutes: num(o.minutes), net: num(o.net), skipped: o.skipped === true };
  } catch {
    return null;
  }
}

let mem: string | null = null;
const bus = new EventTarget();

function stores(): Storage[] {
  const out: Storage[] = [];
  try { out.push(localStorage); } catch { /* blocked or missing */ }
  try { out.push(sessionStorage); } catch { /* blocked or missing */ }
  return out;
}

export function readFelt(key: string): FeltRecord | null {
  for (const st of stores()) {
    try {
      const r = parseFelt(st.getItem(FELT_STORAGE_KEY), key);
      if (r) return r;
    } catch { /* ignore */ }
  }
  return parseFelt(mem, key);
}

export function writeFelt(rec: FeltRecord): void {
  const raw = JSON.stringify(rec);
  mem = raw;
  for (const st of stores()) {
    try { st.setItem(FELT_STORAGE_KEY, raw); break; } catch { /* try the next */ }
  }
  bus.dispatchEvent(new Event('felt'));
}

/** Called after every writeFelt (same page). Returns the unsubscribe function. */
export function onFelt(cb: () => void): () => void {
  bus.addEventListener('felt', cb);
  return () => bus.removeEventListener('felt', cb);
}

/** Parse the intro form fields: minutes ≥ 0, amount ≥ 0 with a direction. Blank or invalid → null. */
export function parseFeltInput(
  minutes: string, amount: string, dir: 'won' | 'lost' | 'even' | '',
): { minutes: number | null; net: number | null } {
  const n = (s: string): number | null => {
    const v = Number(s.replace(/[,\s]/g, ''));
    return s.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : null;
  };
  let net: number | null = null;
  if (dir === 'even') net = 0;
  else if (dir === 'won' || dir === 'lost') {
    const a = n(amount);
    if (a !== null) net = dir === 'won' ? a : -a;
  }
  return { minutes: n(minutes), net };
}
