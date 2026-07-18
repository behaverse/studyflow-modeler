/** Normalize an attribute value into an array of strings for the array editor. */
export function toArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((item) => (item == null ? '' : String(item)));
  if (raw == null || raw === '') return [];
  return [String(raw)];
}
