/** Normalize an attribute value into an array of strings for the array editor. */
export function toArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((item) => (item == null ? '' : String(item)));
  if (raw == null || raw === '') return [];
  return [String(raw)];
}

/** Map an attribute's local name to a data-flow direction, if it denotes one. */
export function inferDirection(localName: string): 'inputs' | 'outputs' | undefined {
  if (localName === 'inputs') return 'inputs';
  if (localName === 'outputs') return 'outputs';
  return undefined;
}
