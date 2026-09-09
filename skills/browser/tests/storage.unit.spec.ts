import { expect, test } from '@playwright/test';
import {
  createDiagramHandoff,
  jsonCodec,
  numberCodec,
  readDiagramHandoff,
  stringCodec,
  sweepDiagramHandoffs,
  takeDiagramHandoff,
  writeStored,
} from '@runner/storage';

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

test.describe('codecs', () => {
  test('stringCodec round-trips verbatim', () => {
    expect(stringCodec.decode(stringCodec.encode('a b'))).toBe('a b');
  });

  test('numberCodec accepts positive integers only', () => {
    expect(numberCodec.decode('320')).toBe(320);
    expect(numberCodec.decode('0')).toBeUndefined();
    expect(numberCodec.decode('-4')).toBeUndefined();
    expect(numberCodec.decode('not-a-number')).toBeUndefined();
  });

  test('jsonCodec refuses corrupt payloads instead of throwing', () => {
    const codec = jsonCodec<{ a: number }>();
    expect(codec.decode('{"a":1}')).toEqual({ a: 1 });
    expect(codec.decode('{oops')).toBeUndefined();
  });
});

test.describe('write results', () => {
  test('no storage at all reports unavailable', () => {
    expect(writeStored('studyflow-modeler:test', 'x')).toBe('unavailable');
  });

  test('a landed write reports ok', () => {
    installFakeStorage();
    expect(writeStored('studyflow-modeler:test', 'x')).toBe('ok');
  });

  test('quota errors report quota and clear the stale entry', () => {
    const backing = installFakeStorage({
      setItem: () => {
        const err = new Error('full');
        err.name = 'QuotaExceededError';
        throw err;
      },
    });
    backing.set('studyflow-modeler:test', 'stale');
    expect(writeStored('studyflow-modeler:test', 'new')).toBe('quota');
    expect(backing.has('studyflow-modeler:test')).toBe(false);
  });
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
    // Sweep "one hour and a bit" later: the fresh entry ages out too.
    expect(sweepDiagramHandoffs(Date.now() + 61 * 60 * 1000)).toBe(2);
    expect(readDiagramHandoff(id)).toBeUndefined();
  });
});
