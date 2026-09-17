import { expect, test } from '@playwright/test';

import { parseImplementationRef, type ImplementationRef } from '@core/implementation';

/** Grammar: `<scheme>://<ref>[@<version-or-digest>]`, ref/version split at the LAST `@`. */

test('parseImplementationRef accepts a scheme, a ref, and an optional version', () => {
  const CASES: [label: string, input: string, value: ImplementationRef][] = [
    ['a python function with a version', 'python://pkg_for_st.do_map@1.2', { scheme: 'python', ref: 'pkg_for_st.do_map', version: '1.2' }],
    ['a docker image with a digest', 'docker://ghcr.io/lab/img@sha256:abc123', { scheme: 'docker', ref: 'ghcr.io/lab/img', version: 'sha256:abc123' }],
    ['an https script without a version', 'https://example.org/scripts/clean.py', { scheme: 'https', ref: 'example.org/scripts/clean.py' }],
    ['a ref holding an @ of its own', 'https://user@example.org/clean.py@v2', { scheme: 'https', ref: 'user@example.org/clean.py', version: 'v2' }],
    ['a capitalized scheme, lowercased, and surrounding whitespace, trimmed', '  Python://pkg.fn@1.0  ', { scheme: 'python', ref: 'pkg.fn', version: '1.0' }],
    // Informational: whether a scheme can run is the runner's call.
    ['a scheme no runner knows', 'r://stats::median@4.4', { scheme: 'r', ref: 'stats::median', version: '4.4' }],
  ];
  for (const [label, input, value] of CASES) {
    expect(parseImplementationRef(input), label).toEqual({ ok: true, value });
  }
});

test('parseImplementationRef rejects a malformed reference and says why', () => {
  // The error names the part at fault; its wording is the source's.
  const CASES: [label: string, input: string | null | undefined, error: RegExp][] = [
    ['empty string', '', /empty/],
    ['whitespace only', '   ', /empty/],
    ['null', null, /empty/],
    ['undefined', undefined, /empty/],
    ['no scheme', 'pkg_for_st.do_map@1.2', /scheme/],
    ['a malformed scheme separator', 'python:/oops', /scheme/],
    ['an empty ref', 'python://', /empty.*ref/],
    ['an empty ref before a version', 'python://@1.2', /empty.*ref/],
    ['a trailing @ with no version', 'python://pkg.fn@', /empty.*version/],
    ['whitespace inside the ref', 'python://pkg .fn@1.2', /whitespace/],
  ];
  for (const [label, input, error] of CASES) {
    const result = parseImplementationRef(input);
    expect(result.ok, label).toBe(false);
    if (!result.ok) expect(result.error, label).toMatch(error);
  }
});
