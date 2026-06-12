/**
 * Parser for the `uses` executable-binding reference on activities.
 *
 * Grammar (GitHub-Actions inspired):
 *
 *     <scheme>://<ref>[@<version-or-digest>]
 *
 * Examples:
 *
 *     python://pkg_for_st.do_map@1.2
 *     docker://ghcr.io/lab/img@sha256:abc123
 *     https://example.org/scripts/clean.py@v2
 *
 * The ref/version split happens at the LAST `@`, so docker digests
 * (`@sha256:...`) and refs containing `@` earlier in the string both parse.
 * Schemes outside KNOWN_SCHEMES parse fine; callers may surface them as
 * informational rather than errors.
 */

export type ParsedUses = {
  scheme: string;
  ref: string;
  version?: string;
};

export type UsesParseResult =
  | { ok: true; value: ParsedUses }
  | { ok: false; error: string };

/** Schemes with first-class support; others parse but may be flagged as informational. */
export const KNOWN_SCHEMES: readonly string[] = ['python', 'docker', 'https'];

// RFC 3986 scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/;

export function parseUses(raw: string | undefined | null): UsesParseResult {
  const input = (raw ?? '').trim();
  if (!input) {
    return { ok: false, error: 'empty binding: expected <scheme>://<ref>[@<version>]' };
  }

  const match = SCHEME_RE.exec(input);
  if (!match) {
    return { ok: false, error: `missing '<scheme>://' prefix in '${input}'` };
  }

  const scheme = match[1].toLowerCase();
  const rest = match[2];
  if (!rest) {
    return { ok: false, error: `empty ref after '${scheme}://'` };
  }

  const at = rest.lastIndexOf('@');
  const ref = at === -1 ? rest : rest.slice(0, at);
  const version = at === -1 ? undefined : rest.slice(at + 1);

  if (!ref) {
    return { ok: false, error: `empty ref in '${input}'` };
  }
  if (version !== undefined && !version) {
    return { ok: false, error: `empty version after '@' in '${input}'` };
  }
  if (/\s/.test(ref) || (version !== undefined && /\s/.test(version))) {
    return { ok: false, error: `whitespace is not allowed in '${input}'` };
  }

  return { ok: true, value: version === undefined ? { scheme, ref } : { scheme, ref, version } };
}
