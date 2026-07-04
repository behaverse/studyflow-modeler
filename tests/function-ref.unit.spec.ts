import { expect, test } from '@playwright/test';

import { KNOWN_SCHEMES, parseFunctionRef } from '../src/lib/core/parsers/functionRef';

/**
 * Unit tests for the `uses` function-reference grammar:
 * `<scheme>://<ref>[@<version-or-digest>]`, ref/version split at the LAST `@`.
 */

test.describe('parseFunctionRef', () => {
  test('parses a python function reference with version', () => {
    const result = parseFunctionRef('python://pkg_for_st.do_map@1.2');
    expect(result).toEqual({
      ok: true,
      value: { scheme: 'python', ref: 'pkg_for_st.do_map', version: '1.2' },
    });
  });

  test('parses a docker image with sha256 digest (last-@ split)', () => {
    const result = parseFunctionRef('docker://ghcr.io/lab/img@sha256:abc123');
    expect(result).toEqual({
      ok: true,
      value: { scheme: 'docker', ref: 'ghcr.io/lab/img', version: 'sha256:abc123' },
    });
  });

  test('parses an https script URL without version', () => {
    const result = parseFunctionRef('https://example.org/scripts/clean.py');
    expect(result).toEqual({
      ok: true,
      value: { scheme: 'https', ref: 'example.org/scripts/clean.py' },
    });
  });

  test('splits at the LAST @ when ref itself contains one', () => {
    const result = parseFunctionRef('https://user@example.org/clean.py@v2');
    expect(result).toEqual({
      ok: true,
      value: { scheme: 'https', ref: 'user@example.org/clean.py', version: 'v2' },
    });
  });

  test('lowercases the scheme and trims surrounding whitespace', () => {
    const result = parseFunctionRef('  Python://pkg.fn@1.0  ');
    expect(result).toEqual({
      ok: true,
      value: { scheme: 'python', ref: 'pkg.fn', version: '1.0' },
    });
  });

  test('accepts unknown schemes (informational, not an error)', () => {
    const result = parseFunctionRef('r://stats::median@4.4');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scheme).toBe('r');
      expect(KNOWN_SCHEMES).not.toContain('r');
    }
  });

  test('exports the known schemes', () => {
    expect(KNOWN_SCHEMES).toEqual(['python', 'docker', 'https', 'file']);
  });

  for (const [label, input] of [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
  ] as const) {
    test(`rejects ${label}`, () => {
      const result = parseFunctionRef(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('empty function reference');
    });
  }

  test('rejects a reference without a scheme', () => {
    const result = parseFunctionRef('pkg_for_st.do_map@1.2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("missing '<scheme>://'");
  });

  test('rejects a malformed scheme separator', () => {
    const result = parseFunctionRef('python:/oops');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("missing '<scheme>://'");
  });

  test('rejects an empty ref', () => {
    const result = parseFunctionRef('python://');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('empty ref');
  });

  test('rejects an empty ref before a version', () => {
    const result = parseFunctionRef('python://@1.2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('empty ref');
  });

  test('rejects a trailing @ with no version', () => {
    const result = parseFunctionRef('python://pkg.fn@');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('empty version');
  });

  test('rejects whitespace inside the ref', () => {
    const result = parseFunctionRef('python://pkg .fn@1.2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('whitespace');
  });
});
