import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { differs, serialize, syncAll, syncDict } from './i18n-sync';

describe('syncDict', () => {
  it('adds missing keys as "", removes extras, keeps translations, sorts', () => {
    const ko = { 'b.x': '가', 'a.y': '나', 'a.z': '다' };
    const out = syncDict(ko, { 'a.y': 'two', gone: 'x' });
    expect(out).toEqual({ 'a.y': 'two', 'a.z': '', 'b.x': '' });
    expect(Object.keys(out)).toEqual(['a.y', 'a.z', 'b.x']);
  });
  it('is idempotent', () => {
    const next = syncDict({ b: '1', a: '2' }, undefined);
    expect(differs(next, syncDict({ b: '1', a: '2' }, next))).toBe(false);
  });
  it('serializes with trailing newline', () => {
    expect(serialize({ a: '' })).toBe('{\n  "a": ""\n}\n');
  });
});

describe('syncAll', () => {
  it('writes, then --check passes; check fails before', () => {
    const root = mkdtempSync(join(tmpdir(), 'i18n-'));
    try {
      mkdirSync(join(root, 'i18n', 'gambling'), { recursive: true });
      mkdirSync(join(root, 'i18n', 'understanding'), { recursive: true });
      writeFileSync(join(root, 'i18n/gambling/hud.ko.json'), '{"hud.b":"b","hud.a":"a"}');
      writeFileSync(join(root, 'i18n/gambling/hud.en.json'), '{"hud.a":"A","hud.old":"x"}');
      writeFileSync(join(root, 'i18n/understanding/quiz.ko.json'), '{"quiz.q":"q"}');
      expect(syncAll(root, false).length).toBe(4); // hud.en, hud.it, quiz.en, quiz.it
      syncAll(root, true);
      expect(JSON.parse(readFileSync(join(root, 'i18n/gambling/hud.en.json'), 'utf8'))).toEqual({ 'hud.a': 'A', 'hud.b': '' });
      expect(JSON.parse(readFileSync(join(root, 'i18n/understanding/quiz.it.json'), 'utf8'))).toEqual({ 'quiz.q': '' });
      expect(syncAll(root, false)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
