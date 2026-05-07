// Completion-code resolution for the End node. The schema defines three modes
// (`none`, `static`, `dynamic`). For `dynamic`, the schema's intent is "extract
// from URL pattern at runtime (e.g. Prolific)" - we honor this by reading
// known query params off the parent page URL, then fall back to a generated
// random code so the redirect URL still resolves.

const PARAM_NAMES = ['cc', 'completion_code', 'COMPLETION_CODE', 'PROLIFIC_PID'];

export type CompletionCodeType = 'none' | 'static' | 'dynamic';

export function resolveCompletionCode(
  type: CompletionCodeType,
  staticValue: string | undefined,
): string | null {
  if (type === 'none') return null;
  if (type === 'static') return staticValue?.trim() || null;

  // dynamic: try known URL params first, otherwise generate.
  const params = new URLSearchParams(window.location.search);
  for (const key of PARAM_NAMES) {
    const v = params.get(key);
    if (v && v.trim()) return v.trim();
  }
  return generateRandomCode(8);
}

export function substituteCompletionCode(template: string, code: string | null): string {
  if (!code) return template.replace(/\{COMPLETION_CODE\}/g, '');
  return template.replace(/\{COMPLETION_CODE\}/g, encodeURIComponent(code));
}

function generateRandomCode(length: number): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  for (let i = 0; i < length; i += 1) {
    out += alphabet[buf[i] % alphabet.length];
  }
  return out;
}
