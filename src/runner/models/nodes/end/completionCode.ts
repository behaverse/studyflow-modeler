// `dynamic` mode reads known query params (e.g. Prolific), falling back to a generated code.

import { getAttribute } from '@/core/extensions';
import type { FlowNode } from '@/runner/models/flow';

const PARAM_NAMES = ['cc', 'completion_code', 'COMPLETION_CODE', 'PROLIFIC_PID'];

export type CompletionCodeType = 'none' | 'static' | 'dynamic';

/** The end event's completion-code strategy, defaulting to `none`. */
export function readCompletionCodeType(node: FlowNode): CompletionCodeType {
  return (getAttribute(node.businessObject, 'completionCodeType') as CompletionCodeType | undefined) ?? 'none';
}

export function resolveCompletionCode(
  type: CompletionCodeType,
  staticValue: string | undefined,
): string | null {
  if (type === 'none') return null;
  if (type === 'static') return staticValue?.trim() || null;

  const params = new URLSearchParams(window.location.search);
  for (const key of PARAM_NAMES) {
    const value = params.get(key);
    if (value && value.trim()) return value.trim();
  }
  return generateRandomCode(8);
}

export function substituteCompletionCode(template: string, code: string | null): string {
  if (!code) return template.replace(/\{COMPLETION_CODE\}/g, '');
  return template.replace(/\{COMPLETION_CODE\}/g, encodeURIComponent(code));
}

function generateRandomCode(length: number): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  const randomBytes = new Uint32Array(length);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < length; i += 1) {
    code += alphabet[randomBytes[i] % alphabet.length];
  }
  return code;
}
