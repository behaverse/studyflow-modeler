import { expect, test } from '@playwright/test';
import {
  createDiagramHandoff,
  jsonCodec,
  numberCodec,
  readDiagramHandoff,
  sweepDiagramHandoffs,
  takeDiagramHandoff,
  writeStored,
  type WriteResult,
} from '@core/storage';

/** Codecs, degraded-environment writes, and the hand-off envelope, against a fake `window.localStorage`. */

function installFakeStorage(overrides: Partial<Storage> = {}): Map<string, string> {
  const backing = new Map<string, string>();
  const fake = {
    getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
    setItem: (key: string, value: string) => { backing.set(key, String(value)); },
    removeItem: (key: string) => { backing.delete(key); },
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() { return backing.size; },
    clear: () => backing.clear(),
    ...overrides,
  };
  (globalThis as any).window = { localStorage: fake };
  return backing;
}

test.afterEach(() => {
  delete (globalThis as any).window;
});

test('a codec decodes what it can and refuses the rest instead of throwing', () => {
  const CASES: [label: string, codec: { decode(raw: string): unknown }, raw: string, expected: unknown][] = [
    ['numberCodec: a positive number', numberCodec, '320', 320],
    ['numberCodec: not zero', numberCodec, '0', undefined],
    ['numberCodec: not a negative', numberCodec, '-4', undefined],
    ['numberCodec: not text', numberCodec, 'not-a-number', undefined],
    ['jsonCodec: JSON', jsonCodec(), '{"a":1}', { a: 1 }],
    ['jsonCodec: not a corrupt payload', jsonCodec(), '{oops', undefined],
  ];
  for (const [label, codec, raw, expected] of CASES) {
    expect(codec.decode(raw), label).toEqual(expected);
  }
});

test('a write reports whether it landed; a full storage also drops the stale entry', () => {
  const full = () => {
    const err = new Error('full');
    err.name = 'QuotaExceededError';
    throw err;
  };
  const CASES: [label: string, storage: Partial<Storage> | undefined, result: WriteResult, left?: string][] = [
    ['no storage at all', undefined, 'unavailable'],
    ['a write that lands', {}, 'ok', 'new'],
    ['a full storage', { setItem: full }, 'quota', undefined],
  ];
  for (const [label, storage, result, left] of CASES) {
    delete (globalThis as any).window;
    const backing = storage && installFakeStorage(storage);
    backing?.set('studyflow-modeler:test', 'stale');
    expect(writeStored('studyflow-modeler:test', 'new'), label).toBe(result);
    if (backing) expect(backing.get('studyflow-modeler:test'), `${label}: what the key holds`).toBe(left);
  }
});

test.describe('diagram hand-off', () => {
  test('create -> read -> take consumes the entry', () => {
    installFakeStorage();
    const { id, result } = createDiagramHandoff('<xml/>');
    expect(result).toBe('ok');
    expect(readDiagramHandoff(id)).toBe('<xml/>');
    expect(takeDiagramHandoff(id)).toBe('<xml/>');
    expect(readDiagramHandoff(id)).toBeUndefined();
  });

  test('sweep drops abandoned and unparseable entries, keeps fresh ones', () => {
    installFakeStorage();
    const { id } = createDiagramHandoff('<xml/>');
    (globalThis as any).window.localStorage.setItem('studyflow-modeler:handoff:junk', 'not json');
    expect(sweepDiagramHandoffs()).toBe(1);
    expect(readDiagramHandoff(id)).toBe('<xml/>');
    // An hour and a bit later, the same entry is abandoned.
    expect(sweepDiagramHandoffs(Date.now() + 61 * 60 * 1000)).toBe(1);
    expect(readDiagramHandoff(id)).toBeUndefined();
  });
});
