export type ImplementationRef = {
  scheme: string;
  ref: string;
  version?: string;
  /** What `#` names inside the ref: a plugin in a repository (`…@v0.4.0#flanker`). */
  fragment?: string;
};

export type ImplementationRefParseResult =
  | { ok: true; value: ImplementationRef }
  | { ok: false; error: string };

const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/;

export function parseImplementationRef(raw: string | undefined | null): ImplementationRefParseResult {
  const input = (raw ?? '').trim();
  if (!input) {
    return { ok: false, error: 'empty function reference: expected <scheme>://<ref>[@<version>][#<fragment>]' };
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

  // A fragment comes last, as in a URL; the version is what follows the last `@` before it.
  const hash = rest.indexOf('#');
  const located = hash === -1 ? rest : rest.slice(0, hash);
  const fragment = hash === -1 ? undefined : rest.slice(hash + 1);
  const at = located.lastIndexOf('@');
  const ref = at === -1 ? located : located.slice(0, at);
  const version = at === -1 ? undefined : located.slice(at + 1);

  if (!ref) {
    return { ok: false, error: `empty ref in '${input}'` };
  }
  if (version !== undefined && !version) {
    return { ok: false, error: `empty version after '@' in '${input}'` };
  }
  if (fragment !== undefined && !fragment) {
    return { ok: false, error: `empty fragment after '#' in '${input}'` };
  }
  if (/\s/.test(rest)) {
    return { ok: false, error: `whitespace is not allowed in '${input}'` };
  }

  return {
    ok: true,
    value: { scheme, ref, ...(version === undefined ? {} : { version }), ...(fragment === undefined ? {} : { fragment }) },
  };
}
