export type ImplementationRef = {
  scheme: string;
  ref: string;
  version?: string;
};

export type ImplementationRefParseResult =
  | { ok: true; value: ImplementationRef }
  | { ok: false; error: string };

export const KNOWN_SCHEMES: readonly string[] = ['python', 'docker', 'https', 'file'];

const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/;

export function parseImplementationRef(raw: string | undefined | null): ImplementationRefParseResult {
  const input = (raw ?? '').trim();
  if (!input) {
    return { ok: false, error: 'empty function reference: expected <scheme>://<ref>[@<version>]' };
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
